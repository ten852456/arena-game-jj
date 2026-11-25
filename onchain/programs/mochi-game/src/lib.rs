//! Mochi Moon game program. The authoritative rules are `mochi-engine` (bit-exact with the TS game, sim v22 /
//! run v14); this program adds what only the chain can enforce:
//! - the secret seed lifecycle (onchain/docs/RANDOMNESS.md): one VRF request per run, the secret in a `RunSecret`
//!   account nobody can read (zero-member permission), a public commitment at run start, the secret revealed at run
//!   end; every roll (shop, rerolls, bonuses, stars, wishes, relics, marks, fight seed, opponent) comes from it
//! - zero-copy state (Player, Pool shard, Ranking, RunSecret): account bytes used in place
//! - versioning (magic, layout version, sim version) checked on every access
//! - phase guards: shop actions and fights only in the shop phase, last chance / mark only in their phases
//! - batching: `act_batch` applies up to MAX_BATCH actions atomically
//! - compressed ghosts (engine::ghost): per-day delta journal, per-player ring arena in the pool shard
//! - the last fight (seed, day, opponent build) so the client replays it with the TS sim
//! - session keys: the owner (wallet) approves a browser key once (<= 7 days, revocable); it can only play
//!   (gameplay instructions of this program), never move SOL
//! - MagicBlock TEE: delegation + permissions (Player: owner + session key; Pool and Ranking: nobody)
//! - season end: ranking (personal best, tie → first achieved), Merkle root of rewards published on Solana,
//!   private proofs, scrub-before-commit, claim on Solana (proven in the PoC programs/mochi-v3)
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi},
        structs::{EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG},
    },
    anchor::{commit, delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
};
use ephemeral_vrf_sdk::anchor::{vrf, vrf_callback};
use ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use mochi_engine::data::{BOT_BUILDS, BOT_DAYS, BOT_K, SIM_VERSION};
use mochi_engine::ghost::{journal_day, GhostSet, JOURNAL_MAX, MAX_GHOSTS};
use mochi_engine::run::{hero_choices, RunState, PHASE_DEAD, PHASE_LASTCHANCE, PHASE_MARK, PHASE_RELIC, PHASE_SHOP, PHASE_WON, RUN_STATE_SIZE};
use mochi_engine::types::Build;
use solana_sha256_hasher::hashv;

declare_id!("Fu3JUGUS5QYmpyXVGLrD7oKChrAhjZCxEcFK1jTcrSh");

pub const PLAYER_MAGIC: u32 = 0x4D50_4C31; // "MPL1"
pub const POOL_MAGIC: u32 = 0x4D50_4F31; // "MPO1"
pub const RANK_MAGIC: u32 = 0x4D52_4B31; // "MRK1"
pub const SECRET_MAGIC: u32 = 0x4D53_4331; // "MSC1"
pub const SSECRET_MAGIC: u32 = 0x4D53_5331; // "MSS1"
/// layout 4 = sim v22 / run v14 (RunState 184 B, 93-byte builds, 7-byte ghost skills, RunSecret)
pub const LAYOUT: u16 = 4;
pub const BUILD_BYTES: usize = core::mem::size_of::<Build>();
/// a VRF request that got no callback for this many slots may be re-sent (same run, output never seen)
pub const VRF_TIMEOUT_SLOTS: u64 = if cfg!(feature = "local") { 20 } else { 3_000 }; // local: short, for the timeout tests
/// RunSecret.status
pub const SEC_NONE: u32 = 0;
pub const SEC_WAITING: u32 = 1;
pub const SEC_SET: u32 = 2;
/// Player.pend_state
pub const PEND_NONE: u8 = 0;
pub const PEND_WAIT: u8 = 1;
/// request_action codes (run-gen.mts codes; 10 = fight)
pub const CODE_FIGHT: u8 = 10;
pub const RANDOM_CODES: [u8; 5] = [3, 6, 7, 8, 12];
/// random actions logged per run (16 B each); the last RAND_FIGHT_RESERVE are kept for fights
pub const RAND_LOG: usize = 256;
pub const RAND_FIGHT_RESERVE: usize = 24;

/// a session key is valid for at most this long (the owner re-approves after)
pub const MAX_SESSION: i64 = 7 * 86_400;
pub const SEATS: usize = 6;
pub const GHOST_SET: usize = core::mem::size_of::<GhostSet>();
pub const MAX_BATCH: usize = 32;
/// Player.seat before join_pool
pub const NO_SEAT: u8 = 255;
pub const LB_SIZE: usize = 16;
pub const LB_DEPTH: usize = 4;
pub const REWARDS: [u32; LB_SIZE] = [1000, 600, 400, 300, 250, 200, 150, 120, 100, 100, 80, 80, 60, 60, 50, 50];
/// Player.status
pub const ST_IDLE: u8 = 0;
pub const ST_PICK: u8 = 1;
pub const ST_RUN: u8 = 2;
pub const ST_ENDED: u8 = 3;
pub const ST_FINAL: u8 = 4;
/// begin_run sent the VRF request; nothing random exists yet
pub const ST_WAIT_VRF: u8 = 5;
/// Player.last_kind
pub const OPP_GHOST: u8 = 1;
pub const OPP_BOT: u8 = 2;

#[ephemeral]
#[program]
pub mod mochi_game {
    use super::*;

    // ======================= Solana (base layer) =======================

    /// `secret_commit` = sha256(season secret): fixes the season secret before any run starts (RANDOMNESS.md §2)
    pub fn init_season(ctx: Context<InitSeason>, id: u32, start_ts: i64, end_ts: i64, secret_commit: [u8; 32]) -> Result<()> {
        ctx.accounts.season.secret_commit = secret_commit;
        require!(end_ts > start_ts, GameError::BadTime);
        let s = &mut ctx.accounts.season;
        s.admin = ctx.accounts.admin.key();
        s.id = id;
        s.start_ts = start_ts;
        s.end_ts = end_ts;
        Ok(())
    }

    /// Admin: move the season end (only while the season is running, never into the past).
    pub fn set_season_end(ctx: Context<SetSeasonEnd>, end_ts: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let s = &mut ctx.accounts.season;
        require!(now < s.end_ts && end_ts > now && end_ts > s.start_ts, GameError::BadTime);
        s.end_ts = end_ts;
        Ok(())
    }

    pub fn init_pool(ctx: Context<InitPool>, season: u32, shard: u16) -> Result<()> {
        prefund(&ctx.accounts.admin, &ctx.accounts.pool.to_account_info(), &ctx.accounts.system_program, 0)?;
        let mut p = ctx.accounts.pool.load_init()?;
        p.magic = POOL_MAGIC;
        p.layout = LAYOUT;
        p.sim = SIM_VERSION as u16;
        p.season = season;
        p.shard = shard;
        Ok(())
    }

    pub fn init_ranking(ctx: Context<InitRanking>, season: u32) -> Result<()> {
        prefund(&ctx.accounts.admin, &ctx.accounts.ranking.to_account_info(), &ctx.accounts.system_program, 0)?;
        let mut r = ctx.accounts.ranking.load_init()?;
        r.magic = RANK_MAGIC;
        r.season = season;
        Ok(())
    }

    /// Create the player's season account on Solana (before delegation: no secrets yet). The pool seat is taken
    /// later on the TEE (`join_pool`), because the pool shard is delegated there.
    pub fn init_player(ctx: Context<InitPlayer>, season: u32, shard: u16) -> Result<()> {
        prefund(&ctx.accounts.owner, &ctx.accounts.player.to_account_info(), &ctx.accounts.system_program, 2)?;
        prefund(&ctx.accounts.owner, &ctx.accounts.run_secret.to_account_info(), &ctx.accounts.system_program, 0)?;
        let mut pl = ctx.accounts.player.load_init()?;
        pl.magic = PLAYER_MAGIC;
        pl.layout = LAYOUT;
        pl.sim = SIM_VERSION as u16;
        pl.owner = ctx.accounts.owner.key();
        pl.season = season;
        pl.shard = shard;
        pl.seat = NO_SEAT;
        let mut sx = ctx.accounts.run_secret.load_init()?;
        sx.magic = SECRET_MAGIC;
        sx.season = season;
        sx.owner = ctx.accounts.owner.key();
        Ok(())
    }

    /// The season secret's account (on Solana, empty); filled on the TEE by `set_season_secret`.
    pub fn init_season_secret(ctx: Context<InitSeasonSecret>, season: u32) -> Result<()> {
        prefund(&ctx.accounts.admin, &ctx.accounts.season_secret.to_account_info(), &ctx.accounts.system_program, 0)?;
        let mut ss = ctx.accounts.season_secret.load_init()?;
        ss.magic = SSECRET_MAGIC;
        ss.season = season;
        Ok(())
    }

    /// Take a seat in the player's pool shard (on the TEE, where the shard lives). Owner or session key.
    pub fn join_pool(ctx: Context<JoinPool>) -> Result<()> {
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let mut pool = ctx.accounts.pool.load_mut()?;
        check_pool(&pool, pl.season)?;
        require!(pool.shard == pl.shard && pl.seat == NO_SEAT, GameError::BadAccount);
        let owner = pl.owner;
        let n = pool.used as usize;
        let seat = match pool.owners[..n].iter().position(|k| *k == owner) {
            Some(i) => i,
            None => {
                require!(n < SEATS, GameError::PoolFull);
                pool.owners[n] = owner;
                pool.used += 1;
                n
            }
        };
        pl.seat = seat as u8;
        Ok(())
    }

    pub fn delegate_player(ctx: Context<DelegatePlayer>, season: u32) -> Result<()> {
        let v = ctx.accounts.validator.as_ref().map(|v| v.key());
        let owner = ctx.accounts.owner.key();
        ctx.accounts.delegate_player(&ctx.accounts.owner, &[b"player".as_ref(), &season.to_le_bytes(), owner.as_ref()], DelegateConfig { validator: v, ..Default::default() })?;
        Ok(())
    }
    pub fn delegate_secret(ctx: Context<DelegateSecret>, season: u32) -> Result<()> {
        let v = ctx.accounts.validator.as_ref().map(|v| v.key());
        let owner = ctx.accounts.owner.key();
        ctx.accounts.delegate_run_secret(&ctx.accounts.owner, &[b"secret".as_ref(), &season.to_le_bytes(), owner.as_ref()], DelegateConfig { validator: v, ..Default::default() })?;
        Ok(())
    }
    pub fn delegate_season_secret(ctx: Context<DelegateSeasonSecret>, season: u32) -> Result<()> {
        let v = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_season_secret(&ctx.accounts.admin, &[b"season_secret".as_ref(), &season.to_le_bytes()], DelegateConfig { validator: v, ..Default::default() })?;
        Ok(())
    }
    pub fn delegate_pool(ctx: Context<DelegatePool>, season: u32, shard: u16) -> Result<()> {
        let v = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pool(&ctx.accounts.admin, &[b"pool".as_ref(), &season.to_le_bytes(), &shard.to_le_bytes()], DelegateConfig { validator: v, ..Default::default() })?;
        Ok(())
    }
    pub fn delegate_ranking(ctx: Context<DelegateRanking>, season: u32) -> Result<()> {
        let v = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_ranking(&ctx.accounts.admin, &[b"ranking".as_ref(), &season.to_le_bytes()], DelegateConfig { validator: v, ..Default::default() })?;
        Ok(())
    }

    /// Claim a season reward on Solana with the proof the TEE gave the player (any time after the root is
    /// published; one-shot per player per season).
    pub fn claim_reward(ctx: Context<ClaimReward>, season: u32, rank: u8, reward: u32, proof: [[u8; 32]; LB_DEPTH]) -> Result<()> {
        let r = ctx.accounts.ranking.load()?;
        require!(r.magic == RANK_MAGIC && r.season == season && r.closed == 1 && r.published == 1, GameError::BadStatus);
        let owner = ctx.accounts.owner.key();
        let mut h = leaf(season, rank, &owner, reward);
        let mut idx = rank as usize;
        for sib in proof.iter() {
            h = if idx & 1 == 0 { hashv(&[&h[..], &sib[..]]).to_bytes() } else { hashv(&[&sib[..], &h[..]]).to_bytes() };
            idx >>= 1;
        }
        require!(h == r.root, GameError::BadProof);
        let rc = &mut ctx.accounts.receipt;
        rc.owner = owner;
        rc.season = season;
        rc.rank = rank;
        rc.reward = reward;
        let w = &mut ctx.accounts.wallet;
        w.owner = owner;
        w.currency = w.currency.saturating_add(reward as u64);
        Ok(())
    }

    // ======================= TEE: permissions =======================

    /// Player is private to its owner and the current session key (create, or update after a new session).
    pub fn player_permission(ctx: Context<PlayerPermission>, season: u32) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        let session = {
            let pl = ctx.accounts.player.load()?;
            require_keys_eq!(pl.owner, owner, GameError::NotOwner);
            pl.session_key
        };
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member { flags, pubkey: owner }];
        if session != Pubkey::default() {
            members.push(Member { flags, pubkey: session });
        }
        let seeds: &[&[u8]] = &[b"player", &season.to_le_bytes(), owner.as_ref(), &[ctx.bumps.player]];
        let acc = ctx.accounts.player.to_account_info();
        if ctx.accounts.permission.lamports() == 0 {
            return permission_cpi(&acc, &ctx.accounts.permission, &ctx.accounts.permission_program, &ctx.accounts.ephemeral_vault, &ctx.accounts.magic_program, members, seeds);
        }
        UpdateEphemeralPermissionCpi {
            payer: acc.clone(),
            permissioned_account: acc.clone(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: acc.clone(),
            authority_is_signer: false,
            args: EphemeralMembersArgs { is_private: true, members },
        }
        .invoke_signed(&[seeds])?;
        Ok(())
    }

    /// Owner approves a session key (the browser's) until `expiry` (at most MAX_SESSION from now).
    pub fn set_session(ctx: Context<OwnerOnly>, key: Pubkey, expiry: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expiry > now && expiry <= now + MAX_SESSION && key != Pubkey::default(), GameError::BadTime);
        let mut pl = owner_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        pl.session_key = key;
        pl.session_expiry = expiry;
        Ok(())
    }

    /// Owner revokes the session key immediately.
    pub fn revoke_session(ctx: Context<OwnerOnly>) -> Result<()> {
        let mut pl = owner_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        pl.session_key = Pubkey::default();
        pl.session_expiry = 0;
        Ok(())
    }
    pub fn pool_permission(ctx: Context<PoolPermission>, season: u32, shard: u16) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            return Ok(());
        }
        let seeds: &[&[u8]] = &[b"pool", &season.to_le_bytes(), &shard.to_le_bytes(), &[ctx.bumps.pool]];
        permission_cpi(&ctx.accounts.pool.to_account_info(), &ctx.accounts.permission, &ctx.accounts.permission_program, &ctx.accounts.ephemeral_vault, &ctx.accounts.magic_program, vec![], seeds)
    }
    /// The run secret's permission: NO members, so no RPC caller (player, session key, admin) can read it.
    pub fn secret_permission(ctx: Context<SecretPermission>, season: u32) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        let bump = ctx.bumps.run_secret;
        let seeds: &[&[u8]] = &[b"secret", &season.to_le_bytes(), owner.as_ref(), &[bump]];
        if ctx.accounts.permission.lamports() == 0 {
            permission_cpi(&ctx.accounts.run_secret.to_account_info(), &ctx.accounts.permission, &ctx.accounts.permission_program, &ctx.accounts.ephemeral_vault, &ctx.accounts.magic_program, vec![], seeds)?;
        }
        ctx.accounts.run_secret.load_mut()?.private = 1;
        Ok(())
    }
    /// The season secret's permission: NO members.
    pub fn season_secret_permission(ctx: Context<SeasonSecretPermission>, season: u32) -> Result<()> {
        let bump = ctx.bumps.season_secret;
        let seeds: &[&[u8]] = &[b"season_secret", &season.to_le_bytes(), &[bump]];
        if ctx.accounts.permission.lamports() == 0 {
            permission_cpi(&ctx.accounts.season_secret.to_account_info(), &ctx.accounts.permission, &ctx.accounts.permission_program, &ctx.accounts.ephemeral_vault, &ctx.accounts.magic_program, vec![], seeds)?;
        }
        ctx.accounts.season_secret.load_mut()?.private = 1;
        Ok(())
    }
    pub fn ranking_permission(ctx: Context<RankingPermission>, season: u32) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            return Ok(());
        }
        let seeds: &[&[u8]] = &[b"ranking", &season.to_le_bytes(), &[ctx.bumps.ranking]];
        permission_cpi(&ctx.accounts.ranking.to_account_info(), &ctx.accounts.permission, &ctx.accounts.permission_program, &ctx.accounts.ephemeral_vault, &ctx.accounts.magic_program, vec![], seeds)
    }

    // ======================= TEE: gameplay =======================

    /// The season secret (admin, on the TEE, once): must match the commitment published at `init_season`.
    pub fn set_season_secret(ctx: Context<SetSeasonSecret>, secret: [u8; 32]) -> Result<()> {
        let mut ss = ctx.accounts.season_secret.load_mut()?;
        require!(ss.magic == SSECRET_MAGIC && ss.season == ctx.accounts.season.id && ss.set == 0, GameError::BadStatus);
        require!(ss.private == 1 || cfg!(feature = "local"), GameError::NotPrivate);
        require!(hashv(&[&secret[..]]).to_bytes() == ctx.accounts.season.secret_commit, GameError::BadCommit);
        ss.secret = secret;
        ss.set = 1;
        Ok(())
    }

    /// Start a run: ONE VRF request; nothing random is computed here (RANDOMNESS.md §2 step 1).
    pub fn begin_run(ctx: Context<BeginRun>) -> Result<()> {
        season_active(&ctx.accounts.season)?;
        let slot = Clock::get()?.slot;
        let (owner, run_no) = {
            let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
            let mut sx = ctx.accounts.run_secret.load_mut()?;
            require!(ctx.accounts.season.id == pl.season, GameError::BadAccount);
            check_secret(&sx, &pl)?;
            require!(sx.private == 1 || cfg!(feature = "local"), GameError::NotPrivate);
            require!(pl.status == ST_IDLE && pl.seat != NO_SEAT, GameError::BadStatus);
            pl.run_no += 1;
            pl.status = ST_WAIT_VRF;
            pl.vrf_slot = slot;
            // the previous run's commitment / choices go: until the callback this run has no random value at all
            pl.secret_commit = [0; 32];
            pl.choices = [0; 4];
            sx.run_no = pl.run_no;
            sx.status = SEC_WAITING;
            (pl.owner, pl.run_no)
        };
        request_vrf(&ctx, owner, run_no)
    }

    /// A VRF request that never came back (after VRF_TIMEOUT_SLOTS): ask again for the SAME run. Safe: the player
    /// never saw an output, so a re-request cannot be used to choose one.
    pub fn retry_vrf(ctx: Context<BeginRun>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let (owner, run_no) = {
            let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
            let sx = ctx.accounts.run_secret.load()?;
            check_secret(&sx, &pl)?;
            require!(pl.status == ST_WAIT_VRF && sx.status == SEC_WAITING && sx.run_no == pl.run_no, GameError::BadStatus);
            require!(slot >= pl.vrf_slot + VRF_TIMEOUT_SLOTS, GameError::BadTime);
            pl.vrf_slot = slot;
            (pl.owner, pl.run_no)
        };
        request_vrf(&ctx, owner, run_no)
    }

    /// VRF callback (signed by the VRF program's scoped identity for this program): derive the run secret, commit to
    /// it, offer the heroes (RANDOMNESS.md §2 step 2).
    /// `run_no` comes back as the request's callback argument: a late callback of an older run is refused.
    pub fn vrf_callback(ctx: Context<VrfCallback>, randomness: [u8; 32], run_no: u32) -> Result<()> {
        let mut pl = ctx.accounts.player.load_mut()?;
        let mut sx = ctx.accounts.run_secret.load_mut()?;
        let ss = ctx.accounts.season_secret.load()?;
        require!(run_no == pl.run_no, GameError::StaleCallback);
        fulfill(&mut pl, &mut sx, &ss, &randomness)
    }

    /// LOCAL VALIDATOR ONLY (feature "local", never deployed): the admin stands in for the VRF oracle.
    #[cfg(feature = "local")]
    pub fn local_vrf(ctx: Context<LocalVrf>, randomness: [u8; 32], run_no: u32) -> Result<()> {
        require_keys_eq!(ctx.accounts.season.admin, ctx.accounts.admin.key(), GameError::NotOwner);
        let mut pl = ctx.accounts.player.load_mut()?;
        let mut sx = ctx.accounts.run_secret.load_mut()?;
        let ss = ctx.accounts.season_secret.load()?;
        require!(run_no == pl.run_no, GameError::StaleCallback);
        fulfill(&mut pl, &mut sx, &ss, &randomness)
    }

    /// Pick one of the offered heroes; the run starts (run.ts newRun with the secret).
    pub fn pick_hero(ctx: Context<PlayerSeason>, choice: u8) -> Result<()> {
        season_active(&ctx.accounts.season)?;
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let sx = ctx.accounts.run_secret.load()?;
        require!(ctx.accounts.season.id == pl.season, GameError::BadAccount);
        check_secret(&sx, &pl)?;
        require!(pl.status == ST_PICK && (choice as usize) < 3 && sx.status == SEC_SET && sx.run_no == pl.run_no, GameError::BadStatus);
        let hero = pl.choices[choice as usize];
        start_run(&mut pl, hero, sx.rs);
        Ok(())
    }

    /// One DETERMINISTIC action (buy, sell, move, lock, slot, pick relic, concede), phase-guarded, one transaction.
    /// Actions with a random outcome go through `request_action` + the VRF callback `apply_random`.
    pub fn act(ctx: Context<PlayerSeason>, code: u8, a: i8, b: i8) -> Result<()> {
        season_active(&ctx.accounts.season)?;
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let sx = ctx.accounts.run_secret.load()?;
        require!(ctx.accounts.season.id == pl.season, GameError::BadAccount);
        check_secret(&sx, &pl)?;
        require!(pl.status == ST_RUN && sx.status == SEC_SET, GameError::BadStatus);
        require!(pl.pend_state == PEND_NONE, GameError::Pending);
        require!(is_deterministic(code), GameError::NeedsRequest);
        require!(apply(run_mut(&mut pl), code, a as i64, b as i64, sx.rs), GameError::Rejected);
        after_actions(&mut pl);
        Ok(())
    }

    /// Up to MAX_BATCH actions (3 bytes each: code, a, b), applied in order, each validated against the state left
    /// by the previous one. All-or-nothing: the state is changed on a copy and written back only if all pass.
    pub fn act_batch(ctx: Context<PlayerSeason>, actions: Vec<u8>) -> Result<()> {
        season_active(&ctx.accounts.season)?;
        require!(actions.len() % 3 == 0 && !actions.is_empty() && actions.len() / 3 <= MAX_BATCH, GameError::BatchSize);
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let sx = ctx.accounts.run_secret.load()?;
        require!(ctx.accounts.season.id == pl.season, GameError::BadAccount);
        check_secret(&sx, &pl)?;
        require!(pl.status == ST_RUN && sx.status == SEC_SET, GameError::BadStatus);
        require!(pl.pend_state == PEND_NONE, GameError::Pending);
        let mut s = *run_mut(&mut pl);
        let n = actions.len() / 3;
        for (i, x) in actions.chunks_exact(3).enumerate() {
            if !is_deterministic(x[0]) || !apply(&mut s, x[0], x[1] as i8 as i64, x[2] as i8 as i64, sx.rs) {
                msg!("batch: action {} rejected", i);
                return err!(GameError::Rejected);
            }
            if s.phase == PHASE_WON || s.phase == PHASE_DEAD {
                require!(i + 1 == n, GameError::Rejected);
            }
        }
        *run_mut(&mut pl) = s;
        after_actions(&mut pl);
        Ok(())
    }

    /// REQUEST (step 1 of 2) of an action with a random outcome: fight (code 10), shop reroll (3), wish (6), last
    /// chance (7), place the last chance's mark (8), relic reroll (12). The action is checked against the current
    /// state and COMMITTED (pending): no other action, no second request, no cancel until it is applied. Nothing random
    /// is computed here, so simulating this transaction reveals nothing (RANDOMNESS.md §3).
    pub fn request_action(ctx: Context<RequestAction>, code: u8, a: i8, b: i8) -> Result<()> {
        season_active(&ctx.accounts.season)?;
        let slot = Clock::get()?.slot;
        let (owner, req) = {
            let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
            let sx = ctx.accounts.run_secret.load()?;
            require!(ctx.accounts.season.id == pl.season, GameError::BadAccount);
            check_secret(&sx, &pl)?;
            {
                let pool = ctx.accounts.pool.load()?;
                let rk = ctx.accounts.ranking.load()?;
                bind(&ctx.accounts.season, &pl, &pool, &rk)?;
            }
            require!(pl.status == ST_RUN && sx.status == SEC_SET, GameError::BadStatus);
            require!(pl.pend_state == PEND_NONE, GameError::Pending);
            require!(!is_deterministic(code) && (code == CODE_FIGHT || RANDOM_CODES.contains(&code)), GameError::BadAction);
            // the action must be legal now; legality never depends on the roll, so a dry run with any seed decides it
            let mut dry = *run_mut(&mut pl);
            let ok = if code == CODE_FIGHT { dry.phase == PHASE_SHOP } else { apply(&mut dry, code, a as i64, b as i64, 0) };
            require!(ok, GameError::Rejected);
            // keep room in the randomness log for the fights of the run
            let room = if code == CODE_FIGHT { RAND_LOG } else { RAND_LOG - RAND_FIGHT_RESERVE };
            require!((pl.rand_n as usize) < room, GameError::LogFull);
            pl.pend_req += 1;
            pl.pend_code = code;
            pl.pend_a = a as u8;
            pl.pend_b = b as u8;
            pl.pend_state = PEND_WAIT;
            pl.pend_slot = slot;
            (pl.owner, pl.pend_req)
        };
        request_act_vrf(&ctx, owner, req)
    }

    /// The pending request's VRF answer never came (after VRF_TIMEOUT_SLOTS): ask again for the SAME action. The
    /// action can't be changed or cancelled, and the first answer was never seen, so this can't pick an outcome.
    pub fn retry_request(ctx: Context<RequestAction>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let (owner, req) = {
            let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
            let sx = ctx.accounts.run_secret.load()?;
            check_secret(&sx, &pl)?;
            require!(pl.pend_state == PEND_WAIT, GameError::BadStatus);
            require!(slot >= pl.pend_slot + VRF_TIMEOUT_SLOTS, GameError::BadTime);
            pl.pend_slot = slot;
            (pl.owner, pl.pend_req)
        };
        request_act_vrf(&ctx, owner, req)
    }

    /// APPLY (step 2 of 2), the VRF callback: the roll uses randomness that did not exist when the request was sent.
    /// Processed once: the pending request is cleared before the action runs; a duplicate or late callback (another
    /// `req`) is refused.
    pub fn apply_random(ctx: Context<ApplyRandom>, randomness: [u8; 32], req: u32) -> Result<()> {
        do_apply(&ctx.accounts.player, &ctx.accounts.run_secret, &ctx.accounts.pool, &ctx.accounts.ranking, &randomness, req)
    }

    /// LOCAL VALIDATOR ONLY (feature "local"): the admin stands in for the VRF oracle.
    #[cfg(feature = "local")]
    pub fn local_apply(ctx: Context<LocalApply>, randomness: [u8; 32], req: u32) -> Result<()> {
        require_keys_eq!(ctx.accounts.season.admin, ctx.accounts.admin.key(), GameError::NotOwner);
        do_apply(&ctx.accounts.player, &ctx.accounts.run_secret, &ctx.accounts.pool, &ctx.accounts.ranking, &randomness, req)
    }

    /// After a concede: archive the run's ghost (final build included) and update the ranking.
    pub fn finish_run(ctx: Context<Fight>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let mut sx = ctx.accounts.run_secret.load_mut()?;
        let mut pool = ctx.accounts.pool.load_mut()?;
        let mut rk = ctx.accounts.ranking.load_mut()?;
        bind(&ctx.accounts.season, &pl, &pool, &rk)?;
        check_secret(&sx, &pl)?;
        require!(pl.status == ST_ENDED && pl.pend_state == PEND_NONE, GameError::BadStatus);
        archive(&mut pl, &mut sx, &mut pool, &mut rk, slot);
        Ok(())
    }

    // ======================= TEE: season end (permissionless after end_ts) =======================

    /// Freeze the ranking and build the Merkle root of (rank, player, reward).
    pub fn close_season(ctx: Context<CloseSeason>, _season: u32) -> Result<()> {
        season_over(&ctx.accounts.season)?;
        let mut r = ctx.accounts.ranking.load_mut()?;
        require!(r.magic == RANK_MAGIC && r.season == ctx.accounts.season.id && r.closed == 0, GameError::BadStatus);
        let leaves = leaves_of(&r);
        r.root = merkle(&leaves);
        r.closed = 1;
        Ok(())
    }

    /// Give one ranked player their (rank, reward, proof), in their own private account.
    pub fn issue_proof(ctx: Context<IssueProof>, _season: u32) -> Result<()> {
        let mut r = ctx.accounts.ranking.load_mut()?;
        let mut pl = ctx.accounts.player.load_mut()?;
        require!(r.magic == RANK_MAGIC && r.season == pl.season && r.closed == 1 && r.published == 0, GameError::BadStatus);
        let n = r.used as usize;
        let rank = r.entries[..n].iter().position(|e| e.player == pl.owner).ok_or(GameError::NotRanked)?;
        let leaves = leaves_of(&r);
        pl.claim_rank = rank as u8;
        pl.claim_reward = REWARDS[rank];
        let proof = proof_of(&leaves, rank);
        for (k, p) in proof.iter().enumerate() {
            pl.claim_proof[k * 32..(k + 1) * 32].copy_from_slice(p);
        }
        pl.claim_ready = 1;
        if r.entries[rank].issued == 0 {
            r.entries[rank].issued = 1;
            r.issued += 1;
        }
        Ok(())
    }

    /// Player's season end: a run still going is cancelled (no ghost, no score), secrets are scrubbed BEFORE the
    /// commit (the committed copy is public), then commit + undelegate.
    pub fn finalize_player(ctx: Context<FinalizePlayer>, _season: u32) -> Result<()> {
        season_over(&ctx.accounts.season)?;
        {
            let mut pl = ctx.accounts.player.load_mut()?;
            require!(pl.magic == PLAYER_MAGIC && pl.season == ctx.accounts.season.id, GameError::BadAccount);
            let mut sx = ctx.accounts.run_secret.load_mut()?;
            check_secret(&sx, &pl)?;
            // the committed copies are public: no secret, no unfinished run state leaves the TEE
            sx.secret = [0; 32];
            sx.vrf = [0; 32];
            sx.rs = 0;
            sx.status = SEC_NONE;
            pl.seen = 0;
            pl.look_seed = 0;
            pl.secret_commit = [0; 32];
            pl.choices = [0; 4];
            pl.run = [0; RUN_STATE_SIZE];
            pl.prev = [0; BUILD_BYTES];
            pl.journal = [0; JOURNAL_MAX];
            pl.journal_len = 0;
            pl.last_opp = [0; BUILD_BYTES];
            pl.last_seed = 0;
            pl.claim_proof = [0; 32 * LB_DEPTH];
            pl.claim_ready = 0;
            pl.status = ST_FINAL;
        }
        MagicIntentBundleBuilder::new(ctx.accounts.payer.to_account_info(), ctx.accounts.magic_context.to_account_info(), ctx.accounts.magic_program.to_account_info())
            .commit_and_undelegate(&[ctx.accounts.player.to_account_info(), ctx.accounts.run_secret.to_account_info()])
            .build_and_invoke()?;
        Ok(())
    }

    /// After every ranked player got their proof: scrub the ranking, publish only the root.
    pub fn publish_root(ctx: Context<PublishRoot>, _season: u32) -> Result<()> {
        {
            let mut r = ctx.accounts.ranking.load_mut()?;
            require!(r.magic == RANK_MAGIC && r.closed == 1 && r.published == 0 && r.issued >= r.used, GameError::BadStatus);
            r.entries = [Entry::default(); LB_SIZE];
            r.published = 1;
        }
        MagicIntentBundleBuilder::new(ctx.accounts.payer.to_account_info(), ctx.accounts.magic_context.to_account_info(), ctx.accounts.magic_program.to_account_info())
            .commit_and_undelegate(&[ctx.accounts.ranking.to_account_info()])
            .build_and_invoke()?;
        Ok(())
    }

    /// Delete every ghost of the season, then commit + undelegate the empty shard.
    pub fn clear_pool(ctx: Context<ClearPool>, _season: u32, _shard: u16) -> Result<()> {
        season_over(&ctx.accounts.season)?;
        {
            let mut p = ctx.accounts.pool.load_mut()?;
            require!(p.magic == POOL_MAGIC && p.season == ctx.accounts.season.id, GameError::BadAccount);
            p.ghosts = [0; SEATS * GHOST_SET];
            p.owners = [Pubkey::default(); SEATS];
            p.used = 0;
            p.nonce = 0;
        }
        MagicIntentBundleBuilder::new(ctx.accounts.payer.to_account_info(), ctx.accounts.magic_context.to_account_info(), ctx.accounts.magic_program.to_account_info())
            .commit_and_undelegate(&[ctx.accounts.pool.to_account_info()])
            .build_and_invoke()?;
        Ok(())
    }

    // ---------------- bench only (feature "bench"): replay recorded runs exactly ----------------
    #[cfg(feature = "bench")]
    pub fn bench_begin(ctx: Context<PlayerSeason>, seed: u32, secret: u32, hero: u8) -> Result<()> {
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        require!(pl.status == ST_IDLE && pl.seat != NO_SEAT, GameError::BadStatus);
        let mut sx = ctx.accounts.run_secret.load_mut()?;
        pl.run_no += 1;
        sx.run_no = pl.run_no;
        sx.status = SEC_SET;
        sx.rs = secret;
        pl.look_seed = seed;
        start_run(&mut pl, hero, secret);
        Ok(())
    }
    #[cfg(feature = "bench")]
    pub fn bench_pick(ctx: Context<Fight>, day: u8) -> Result<()> {
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let pool = ctx.accounts.pool.load()?;
        let mut r = 0x9E37_79B9_7F4A_7C15u64 ^ pl.seen;
        let b = pick_opponent(&mut pl, &pool, day, &mut r);
        core::hint::black_box(b);
        Ok(())
    }
    #[cfg(feature = "bench")]
    pub fn bench_fight_vs(ctx: Context<Fight>, opp: [u8; BUILD_BYTES], seed: u32) -> Result<()> {
        season_active(&ctx.accounts.season)?;
        let slot = Clock::get()?.slot;
        let mut pl = player_mut(&ctx.accounts.player, &ctx.accounts.owner)?;
        let mut sx = ctx.accounts.run_secret.load_mut()?;
        let mut pool = ctx.accounts.pool.load_mut()?;
        let mut rk = ctx.accounts.ranking.load_mut()?;
        bind(&ctx.accounts.season, &pl, &pool, &rk)?;
        require!(pl.status == ST_RUN && run_mut(&mut pl).phase == PHASE_SHOP, GameError::BadPhase);
        let opp: Build = read_build(&opp);
        let rs = sx.rs;
        do_fight(&mut pl, &mut sx, &mut pool, &mut rk, &opp, OPP_BOT, seed, rs, slot);
        Ok(())
    }
}

// ======================= rules the chain adds =======================

/// Phase guard + strict validity, then the engine action (codes as engine/diff/run-gen.mts). Returns accepted.
/// `rs` = the run's secret roll seed (RunSecret.rs): every roll of the run comes from it.
fn apply(s: &mut RunState, code: u8, a: i64, b: i64, rs: u32) -> bool {
    let n = s.n as i64;
    let sec = Some(rs);
    let idx = |x: i64| if x < 0 { usize::MAX } else { x as usize };
    match code {
        0..=6 if s.phase != PHASE_SHOP => false,
        11 | 12 if s.phase != PHASE_RELIC => false,
        // b = branch of an upgrade: -1 = the card's own, 0 / 1 = the first / second next branch
        0 => {
            if b < -1 || b > 1 { return false; }
            s.buy(idx(a), if b < 0 { None } else { Some(b as usize) })
        }
        1 => {
            if a < 0 || a >= n { return false; }
            s.sell(a as usize);
            true
        }
        2 => {
            if a < 0 || a >= n || !(b == 1 || b == -1) || a + b < 0 || a + b >= n { return false; }
            s.move_skill(a, b);
            true
        }
        3 => s.reroll(sec),
        4 => s.toggle_lock(idx(a)),
        5 => s.buy_slot(),
        6 => s.wish(sec),
        7 => {
            if s.phase != PHASE_LASTCHANCE || !(0..=2).contains(&a) { return false; }
            s.choose_last_chance(a as u8, sec);
            true
        }
        8 => s.phase == PHASE_MARK && s.apply_mark(a, sec),
        9 => {
            if s.phase == PHASE_WON || s.phase == PHASE_DEAD { return false; }
            s.concede();
            true
        }
        11 => s.pick_relic(a),
        12 => s.reroll_relic(sec),
        _ => false,
    }
}

/// codes without a random outcome: one transaction (`act`, `act_batch`)
fn is_deterministic(code: u8) -> bool {
    matches!(code, 0 | 1 | 2 | 4 | 5 | 9 | 11)
}

/// apply_random / local_apply: the one place a request's outcome is rolled (RANDOMNESS.md §2a)
fn do_apply<'info>(
    player: &AccountLoader<'info, Player>, run_secret: &AccountLoader<'info, RunSecret>, pool: &AccountLoader<'info, Pool>,
    ranking: &AccountLoader<'info, Ranking>, randomness: &[u8; 32], req: u32,
) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut pl = player.load_mut()?;
    let mut sx = run_secret.load_mut()?;
    let mut pool = pool.load_mut()?;
    let mut rk = ranking.load_mut()?;
    require!(pl.magic == PLAYER_MAGIC && pl.layout == LAYOUT, GameError::BadLayout);
    check_secret(&sx, &pl)?;
    check_pool(&pool, pl.season)?;
    require!(pool.shard == pl.shard && rk.magic == RANK_MAGIC && rk.season == pl.season, GameError::BadAccount);
    require!(pl.pend_state == PEND_WAIT && req == pl.pend_req, GameError::StaleCallback);
    require!(pl.status == ST_RUN && sx.status == SEC_SET, GameError::BadStatus);
    // once: the request is consumed before anything else happens
    pl.pend_state = PEND_NONE;
    let r16: [u8; 16] = randomness[..16].try_into().unwrap();
    let n = pl.rand_n as usize;
    pl.rand_log[n * 16..(n + 1) * 16].copy_from_slice(&r16);
    pl.rand_n += 1;
    let reqb = req.to_le_bytes();
    let act_seed = u32_of(&hashv(&[&sx.secret[..], &r16[..], &reqb[..]]).to_bytes());
    let (code, a, b) = (pl.pend_code, pl.pend_a as i8 as i64, pl.pend_b as i8 as i64);
    if code == CODE_FIGHT {
        let day = run_mut(&mut pl).day;
        let h = hashv(&[&sx.secret[..], &r16[..], &reqb[..], &b"fight"[..]]).to_bytes();
        let seed = u32::from_le_bytes(h[..4].try_into().unwrap());
        let mut r = u64::from_le_bytes(h[8..16].try_into().unwrap()) | 1;
        let (opp, kind) = pick_opponent(&mut pl, &pool, day, &mut r);
        do_fight(&mut pl, &mut sx, &mut pool, &mut rk, &opp, kind, seed, act_seed, slot);
    } else {
        // legal at request time and the state is locked since, so this is accepted; if not, the request is spent anyway
        let ok = apply(run_mut(&mut pl), code, a, b, act_seed);
        if !ok {
            msg!("request {} no longer applies", req);
        }
        after_actions(&mut pl);
    }
    Ok(())
}

/// the VRF request of request_action / retry_request; the callback gets Player, RunSecret, Pool, Ranking + `req`
fn request_act_vrf(ctx: &Context<RequestAction>, owner: Pubkey, req: u32) -> Result<()> {
    let caller_seed = hashv(&[&b"mochi-act"[..], &ctx.accounts.season.id.to_le_bytes()[..], owner.as_ref(), &req.to_le_bytes()[..]]).to_bytes();
    let meta = |k: Pubkey, w: bool| SerializableAccountMeta { pubkey: k.to_bytes().into(), is_signer: false, is_writable: w };
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.owner.key().to_bytes().into(),
        oracle_queue: ctx.accounts.oracle_queue.key().to_bytes().into(),
        callback_program_id: crate::ID.to_bytes().into(),
        callback_discriminator: instruction::ApplyRandom::DISCRIMINATOR.to_vec(),
        caller_seed,
        accounts_metas: Some(vec![meta(ctx.accounts.player.key(), true), meta(ctx.accounts.run_secret.key(), true), meta(ctx.accounts.pool.key(), true), meta(ctx.accounts.ranking.key(), true)]),
        callback_args: Some(req.to_le_bytes().to_vec()),
    });
    if cfg!(feature = "local") {
        return Ok(()); // local validator: the admin answers with `local_apply`
    }
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.owner.to_account_info(), &ix)?;
    Ok(())
}

/// RANDOMNESS.md §2 step 2: run secret = H(vrf ‖ season secret ‖ owner ‖ run), public commitment, hero choices.
fn fulfill(pl: &mut Player, sx: &mut RunSecret, ss: &SeasonSecret, randomness: &[u8; 32]) -> Result<()> {
    require!(pl.magic == PLAYER_MAGIC && pl.layout == LAYOUT, GameError::BadLayout);
    check_secret(sx, pl)?;
    require!(ss.magic == SSECRET_MAGIC && ss.season == pl.season && ss.set == 1, GameError::BadAccount);
    require!(pl.status == ST_WAIT_VRF && sx.status == SEC_WAITING && sx.run_no == pl.run_no, GameError::BadStatus);
    let run = pl.run_no.to_le_bytes();
    let secret = hashv(&[&b"mochi-run"[..], &randomness[..], &ss.secret[..], pl.owner.as_ref(), &run[..]]).to_bytes();
    sx.secret = secret;
    sx.vrf = *randomness;
    sx.rs = u32_of(&hashv(&[&secret[..], &b"run"[..]]).to_bytes());
    sx.status = SEC_SET;
    pl.secret_commit = hashv(&[&b"mochi-commit"[..], &secret[..], &run[..]]).to_bytes();
    pl.look_seed = u32_of(&hashv(&[&secret[..], &b"look"[..]]).to_bytes());
    let c = hero_choices(u32_of(&hashv(&[&secret[..], &b"heroes"[..]]).to_bytes()));
    pl.choices = [c[0], c[1], c[2], 0];
    for (i, &h) in c.iter().enumerate() {
        let day1 = RunState::new(h, pl.look_seed, Some(sx.rs)).to_bytes();
        pl.preview[i * 55..(i + 1) * 55].copy_from_slice(&day1[129..184]);
    }
    pl.status = ST_PICK;
    Ok(())
}
fn u32_of(h: &[u8; 32]) -> u32 {
    u32::from_le_bytes(h[..4].try_into().unwrap())
}
/// the VRF request of begin_run / retry_vrf; the callback gets Player, RunSecret, SeasonSecret
fn request_vrf(ctx: &Context<BeginRun>, owner: Pubkey, run_no: u32) -> Result<()> {
    let caller_seed = hashv(&[&b"mochi-vrf"[..], &ctx.accounts.season.id.to_le_bytes()[..], owner.as_ref(), &run_no.to_le_bytes()[..]]).to_bytes();
    let meta = |k: Pubkey, w: bool| SerializableAccountMeta { pubkey: k.to_bytes().into(), is_signer: false, is_writable: w };
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.owner.key().to_bytes().into(),
        oracle_queue: ctx.accounts.oracle_queue.key().to_bytes().into(),
        callback_program_id: crate::ID.to_bytes().into(),
        callback_discriminator: instruction::VrfCallback::DISCRIMINATOR.to_vec(),
        caller_seed,
        accounts_metas: Some(vec![meta(ctx.accounts.player.key(), true), meta(ctx.accounts.run_secret.key(), true), meta(ctx.accounts.season_secret.key(), false)]),
        callback_args: Some(run_no.to_le_bytes().to_vec()),
    });
    if cfg!(feature = "local") {
        return Ok(()); // no VRF oracle on a local validator: the admin answers with `local_vrf`
    }
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.owner.to_account_info(), &ix)?;
    Ok(())
}
fn check_secret(sx: &RunSecret, pl: &Player) -> Result<()> {
    require!(sx.magic == SECRET_MAGIC && sx.season == pl.season && sx.owner == pl.owner, GameError::BadAccount);
    Ok(())
}

fn start_run(pl: &mut Player, hero: u8, rs: u32) {
    let s = RunState::new(hero, pl.look_seed, Some(rs));
    *run_mut(pl) = s;
    pl.rand_n = 0;
    pl.rand_log = [0; 16 * RAND_LOG];
    pl.pend_state = PEND_NONE;
    pl.journal_len = 0;
    pl.fought = 0;
    pl.prev = build_bytes(&Build { hero, ..Default::default() });
    pl.last_day = 0;
    pl.status = ST_RUN;
}

fn after_actions(pl: &mut Player) {
    let ph = run_mut(pl).phase;
    if ph == PHASE_WON || ph == PHASE_DEAD {
        pl.status = ST_ENDED;
    }
}

fn pick_opponent(pl: &mut Player, pool: &Pool, day: u8, r: &mut u64) -> (Build, u8) {
    let mut eligible: u64 = 0;
    for seat in 0..pool.used as usize {
        let gs = ghost_set(pool, seat);
        for k in 0..MAX_GHOSTS {
            let g = &gs.refs[k];
            if g.live == 1 && g.end_day >= day {
                eligible |= 1 << (seat * MAX_GHOSTS + k);
            }
        }
    }
    let mut rnd = || {
        *r ^= *r << 13;
        *r ^= *r >> 7;
        *r ^= *r << 17;
        *r
    };
    if eligible == 0 {
        let d = (day as usize).clamp(1, BOT_DAYS) - 1;
        return (BOT_BUILDS[d][(rnd() % BOT_K as u64) as usize], OPP_BOT);
    }
    let mut unseen = eligible & !pl.seen;
    if unseen == 0 {
        pl.seen &= !eligible;
        pl.resets += 1;
        unseen = eligible;
    }
    let k = rnd() % unseen.count_ones() as u64;
    let (mut bit, mut c) = (0, 0);
    for i in 0..64 {
        if unseen & (1 << i) != 0 {
            if c == k { bit = i; break; }
            c += 1;
        }
    }
    pl.seen |= 1 << bit;
    (ghost_set(pool, bit / MAX_GHOSTS).build(bit % MAX_GHOSTS, day), OPP_GHOST)
}

/// `act_seed` = the engine's roll seed for this fight (the next day's shop, relic offer)
#[allow(clippy::too_many_arguments)]
fn do_fight(pl: &mut Player, sx: &mut RunSecret, pool: &mut Pool, rk: &mut Ranking, opp: &Build, kind: u8, seed: u32, act_seed: u32, slot: u64) {
    let (day, cur) = {
        let run = run_mut(pl);
        (run.day, run.to_build())
    };
    let prev = read_build(&pl.prev);
    let len = pl.journal_len as usize;
    let w = journal_day(day, &prev, &cur, &mut pl.journal[len..]);
    pl.journal_len += w as u16;
    pl.prev = build_bytes(&cur);
    pl.fought = day;
    let o = run_mut(pl).fight(opp, seed, Some(act_seed));
    // the last fight, for the client's replay: simulate(build of `day`, last_opp, last_seed, day)
    pl.last_opp = build_bytes(opp);
    pl.last_seed = seed;
    pl.last_day = day;
    pl.last_kind = kind;
    pl.last_result = (o.winner + 2) as u8; // 1 draw, 2 won, 3 lost
    let ph = run_mut(pl).phase;
    if ph == PHASE_WON || ph == PHASE_DEAD {
        archive(pl, sx, pool, rk, slot);
    }
}

/// Store the run's ghost (final build + every fought day), update the personal best + ranking, and reveal the
/// run's secret (anyone can now re-check every roll of the run against `secret_commit`).
fn archive(pl: &mut Player, sx: &mut RunSecret, pool: &mut Pool, rk: &mut Ranking, slot: u64) {
    pl.revealed_secret = sx.secret;
    pl.revealed_vrf = sx.vrf;
    pl.revealed_run = pl.run_no;
    sx.secret = [0; 32];
    sx.vrf = [0; 32];
    sx.rs = 0;
    sx.status = SEC_NONE;

    let (cur, hero, wins, hp) = {
        let run = run_mut(pl);
        (run.to_build(), run.hero, run.wins, run.hp)
    };
    let prev = read_build(&pl.prev);
    let mut end = pl.fought;
    if pl.fought == 0 || cur != prev {
        end = pl.fought + 1;
        let len = pl.journal_len as usize;
        let w = journal_day(end, &prev, &cur, &mut pl.journal[len..]);
        pl.journal_len += w as u16;
    }
    let len = pl.journal_len as usize;
    let seat = pl.seat as usize;
    ghost_set_mut(pool, seat).add(pl.run_no, hero, end, &pl.journal[..len]);
    let score = wins as u32 * 100 + core::cmp::max(hp, 0) as u32;
    if score > pl.best_score {
        // strictly greater: an equal score later never replaces the first one (tie → first achieved)
        pl.best_score = score;
        pl.best_slot = slot;
        lb_update(rk, pl.owner, score, slot);
    }
    pl.status = ST_IDLE;
}

fn lb_update(r: &mut Ranking, player: Pubkey, score: u32, slot: u64) {
    let n = r.used as usize;
    let better = |s: u32, t: u64, s2: u32, t2: u64| s > s2 || (s == s2 && t < t2);
    if let Some(i) = r.entries[..n].iter().position(|e| e.player == player) {
        r.entries[i].score = score;
        r.entries[i].slot = slot;
    } else if n < LB_SIZE {
        r.entries[n] = Entry { player, score, issued: 0, _p: [0; 3], slot };
        r.used += 1;
    } else if better(score, slot, r.entries[LB_SIZE - 1].score, r.entries[LB_SIZE - 1].slot) {
        r.entries[LB_SIZE - 1] = Entry { player, score, issued: 0, _p: [0; 3], slot };
    } else {
        return;
    }
    let n = r.used as usize;
    for i in 1..n {
        let mut j = i;
        while j > 0 && better(r.entries[j].score, r.entries[j].slot, r.entries[j - 1].score, r.entries[j - 1].slot) {
            r.entries.swap(j, j - 1);
            j -= 1;
        }
    }
}

pub fn leaf(season: u32, rank: u8, player: &Pubkey, reward: u32) -> [u8; 32] {
    hashv(&[&b"mochi-leaf"[..], &season.to_le_bytes()[..], &[rank][..], player.as_ref(), &reward.to_le_bytes()[..]]).to_bytes()
}
fn leaves_of(r: &Ranking) -> [[u8; 32]; LB_SIZE] {
    let mut l = [[0u8; 32]; LB_SIZE];
    for i in 0..r.used as usize {
        l[i] = leaf(r.season, i as u8, &r.entries[i].player, REWARDS[i]);
    }
    l
}
fn merkle(leaves: &[[u8; 32]; LB_SIZE]) -> [u8; 32] {
    let mut level = *leaves;
    let mut n = LB_SIZE;
    while n > 1 {
        for i in 0..n / 2 {
            level[i] = hashv(&[&level[2 * i][..], &level[2 * i + 1][..]]).to_bytes();
        }
        n /= 2;
    }
    level[0]
}
fn proof_of(leaves: &[[u8; 32]; LB_SIZE], mut idx: usize) -> [[u8; 32]; LB_DEPTH] {
    let mut out = [[0u8; 32]; LB_DEPTH];
    let mut level = *leaves;
    let mut n = LB_SIZE;
    for d in 0..LB_DEPTH {
        out[d] = level[idx ^ 1];
        for i in 0..n / 2 {
            level[i] = hashv(&[&level[2 * i][..], &level[2 * i + 1][..]]).to_bytes();
        }
        n /= 2;
        idx >>= 1;
    }
    out
}

fn prefund<'info>(payer: &Signer<'info>, to: &AccountInfo<'info>, sys: &Program<'info, System>, members: u32) -> Result<()> {
    transfer(
        CpiContext::new(sys.key(), Transfer { from: payer.to_account_info(), to: to.clone() }),
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(members as usize) as u32),
    )
}

fn permission_cpi<'info>(
    acc: &AccountInfo<'info>, permission: &UncheckedAccount<'info>, permission_program: &UncheckedAccount<'info>,
    vault: &UncheckedAccount<'info>, magic_program: &UncheckedAccount<'info>, members: Vec<Member>, seeds: &[&[u8]],
) -> Result<()> {
    CreateEphemeralPermissionCpi {
        payer: acc.clone(),
        permissioned_account: acc.clone(),
        permission: permission.to_account_info(),
        vault: vault.to_account_info(),
        magic_program: magic_program.to_account_info(),
        permission_program: permission_program.to_account_info(),
        args: EphemeralMembersArgs { is_private: true, members },
    }
    .invoke_signed(&[seeds])?;
    Ok(())
}

// ======================= zero-copy views + checks =======================

const _: () = assert!(core::mem::offset_of!(Player, run) % 4 == 0 && core::mem::size_of::<Player>() % 8 == 0);
const _: () = assert!(core::mem::offset_of!(Pool, ghosts) % 4 == 0 && GHOST_SET == 1600 && BUILD_BYTES == 93 && RUN_STATE_SIZE == 184);

fn run_mut(pl: &mut Player) -> &mut RunState {
    // run is 184 bytes at a 4-aligned offset of an 8-aligned account: a valid, aligned RunState (integers only)
    unsafe { &mut *(pl.run.as_mut_ptr() as *mut RunState) }
}
fn ghost_set(pool: &Pool, seat: usize) -> &GhostSet {
    unsafe { &*(pool.ghosts.as_ptr().add(seat * GHOST_SET) as *const GhostSet) }
}
fn ghost_set_mut(pool: &mut Pool, seat: usize) -> &mut GhostSet {
    unsafe { &mut *(pool.ghosts.as_mut_ptr().add(seat * GHOST_SET) as *mut GhostSet) }
}
fn build_bytes(b: &Build) -> [u8; BUILD_BYTES] {
    unsafe { core::mem::transmute_copy(b) }
}
fn read_build(x: &[u8; BUILD_BYTES]) -> Build {
    unsafe { core::ptr::read_unaligned(x.as_ptr() as *const Build) }
}

/// The signer may play this account: its owner, or the session key the owner approved (until it expires).
fn player_mut<'a>(acc: &'a AccountLoader<'_, Player>, signer: &Signer) -> Result<core::cell::RefMut<'a, Player>> {
    let pl = acc.load_mut()?;
    require!(pl.magic == PLAYER_MAGIC && pl.layout == LAYOUT, GameError::BadLayout);
    require!(pl.sim == SIM_VERSION as u16, GameError::SimVersion);
    let k = signer.key();
    let session_ok = k != Pubkey::default() && pl.session_key == k && Clock::get()?.unix_timestamp < pl.session_expiry;
    require!(pl.owner == k || session_ok, GameError::NotOwner);
    Ok(pl)
}
/// Owner only (session management).
fn owner_mut<'a>(acc: &'a AccountLoader<'_, Player>, owner: &Signer) -> Result<core::cell::RefMut<'a, Player>> {
    let pl = acc.load_mut()?;
    require!(pl.magic == PLAYER_MAGIC && pl.layout == LAYOUT, GameError::BadLayout);
    require_keys_eq!(pl.owner, owner.key(), GameError::NotOwner);
    Ok(pl)
}
fn check_pool(p: &Pool, season: u32) -> Result<()> {
    require!(p.magic == POOL_MAGIC && p.layout == LAYOUT, GameError::BadLayout);
    require!(p.sim == SIM_VERSION as u16, GameError::SimVersion);
    require!(p.season == season, GameError::BadAccount);
    Ok(())
}
/// season / pool shard / ranking must all be the player's
fn bind(season: &Season, pl: &Player, pool: &Pool, rk: &Ranking) -> Result<()> {
    require!(season.id == pl.season, GameError::BadAccount);
    check_pool(pool, pl.season)?;
    require!(pool.shard == pl.shard, GameError::BadAccount);
    require!(rk.magic == RANK_MAGIC && rk.season == pl.season, GameError::BadAccount);
    Ok(())
}
fn season_active(s: &Season) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= s.start_ts && now < s.end_ts, GameError::SeasonOver);
    Ok(())
}
fn season_over(s: &Season) -> Result<()> {
    require!(Clock::get()?.unix_timestamp >= s.end_ts, GameError::SeasonRunning);
    Ok(())
}

// ======================= accounts =======================

#[account]
#[derive(InitSpace)]
pub struct Season {
    pub admin: Pubkey,
    pub id: u32,
    pub start_ts: i64,
    pub end_ts: i64,
    /// sha256(season secret), published before the season starts (RANDOMNESS.md §2)
    pub secret_commit: [u8; 32],
}

const PLAYER_HEAD: usize = 5 * 8 + 5 * 32 + 11 * 4 + 4 * 2 + 12 + 4;
/// the day-1 shop (5 offers × 11 B) of each of the 3 offered heroes: shown openly before the pick (owner decision)
pub const PREVIEW_BYTES: usize = 3 * 5 * 11;
const PLAYER_BODY: usize = PLAYER_HEAD + RUN_STATE_SIZE + 2 * BUILD_BYTES + JOURNAL_MAX + 32 * LB_DEPTH + PREVIEW_BYTES + 16 * RAND_LOG;
pub const PLAYER_PAD: usize = (8 - PLAYER_BODY % 8) % 8;

/// One per player per season. Zero-copy; `run` is a mochi_engine RunState, `prev` / `last_opp` are Builds.
/// Readable by its owner + session key (TEE permission). Holds NO secret of a run in progress: only the commitment
/// (`secret_commit`) and, after a run ended, that run's revealed secret.
#[account(zero_copy)]
pub struct Player {
    /// slot of the pending VRF request (retry_vrf after VRF_TIMEOUT_SLOTS)
    pub vrf_slot: u64,
    /// slot of the pending action request (retry_request after VRF_TIMEOUT_SLOTS)
    pub pend_slot: u64,
    pub seen: u64,
    pub best_slot: u64,
    /// session key the owner approved (wallet signs once); valid while now < session_expiry (unix ts)
    pub session_expiry: i64,
    pub owner: Pubkey,
    pub session_key: Pubkey,
    /// sha256("mochi-commit" ‖ secret ‖ run_no) of the run in progress
    pub secret_commit: [u8; 32],
    /// the last ENDED run (revealed_run): its secret and the VRF output it came from
    pub revealed_secret: [u8; 32],
    pub revealed_vrf: [u8; 32],
    pub magic: u32,
    pub season: u32,
    pub run_no: u32,
    pub resets: u32,
    pub best_score: u32,
    /// the run's cosmetic seed (RunState.seed): H(secret, "look"); no roll uses it
    pub look_seed: u32,
    pub last_seed: u32,
    pub claim_reward: u32,
    pub revealed_run: u32,
    /// the pending / last action request id (monotonic per player) and how many random actions this run applied
    pub pend_req: u32,
    pub rand_n: u32,
    pub layout: u16,
    pub sim: u16,
    pub shard: u16,
    pub journal_len: u16,
    pub seat: u8,
    pub status: u8,
    pub fought: u8,
    /// the last fight (client replay): day, result (1 draw, 2 won, 3 lost), opponent kind
    pub last_day: u8,
    pub last_result: u8,
    pub last_kind: u8,
    pub claim_ready: u8,
    pub claim_rank: u8,
    /// the pending request: code, args (i8 as u8), PEND_NONE / PEND_WAIT
    pub pend_code: u8,
    pub pend_a: u8,
    pub pend_b: u8,
    pub pend_state: u8,
    pub choices: [u8; 4],
    pub run: [u8; RUN_STATE_SIZE],
    pub prev: [u8; BUILD_BYTES],
    pub last_opp: [u8; BUILD_BYTES],
    pub journal: [u8; JOURNAL_MAX],
    pub claim_proof: [u8; 32 * LB_DEPTH],
    /// day-1 shop of each offered hero (choices order), RunState shop bytes: public gameplay information. It comes
    /// from the run's roll seed `rs`, which nothing after day 1 rolls from (every later roll has its own VRF output).
    pub preview: [u8; PREVIEW_BYTES],
    /// first 16 bytes of the VRF output of each random action of this run, in order (public once applied; with the
    /// revealed secret anyone recomputes every roll: act seed = H(secret ‖ r16 ‖ req))
    pub rand_log: [u8; 16 * RAND_LOG],
    pub _pad: [u8; PLAYER_PAD],
}
const _: () = assert!(core::mem::offset_of!(Player, run) == PLAYER_HEAD && core::mem::size_of::<Player>() == PLAYER_BODY + PLAYER_PAD);

/// The run secret (PDA ["secret", season, owner]). Its TEE permission has NO members: no RPC caller can read it;
/// only this program, while executing, does. Scrubbed before it ever leaves the TEE.
#[account(zero_copy)]
pub struct RunSecret {
    pub magic: u32,
    pub season: u32,
    pub run_no: u32,
    /// SEC_NONE / SEC_WAITING (VRF requested) / SEC_SET
    pub status: u32,
    /// the engine's roll seed: u32(H(secret, "run"))
    pub rs: u32,
    /// 1 once the zero-member permission exists (begin_run requires it)
    pub private: u32,
    pub owner: Pubkey,
    pub secret: [u8; 32],
    pub vrf: [u8; 32],
}

/// The season secret (PDA ["season_secret", season]): mixed into every run secret so the VRF oracle alone can't
/// compute one. Zero-member permission; its hash is Season.secret_commit.
#[account(zero_copy)]
pub struct SeasonSecret {
    pub magic: u32,
    pub season: u32,
    pub set: u32,
    pub private: u32,
    pub secret: [u8; 32],
}

#[account(zero_copy)]
pub struct Pool {
    pub nonce: u64,
    pub magic: u32,
    pub season: u32,
    pub layout: u16,
    pub sim: u16,
    pub shard: u16,
    pub used: u8,
    pub _r: u8,
    pub owners: [Pubkey; SEATS],
    pub ghosts: [u8; SEATS * GHOST_SET],
}

#[zero_copy]
#[derive(Default)]
pub struct Entry {
    pub player: Pubkey,
    pub score: u32,
    pub issued: u8,
    pub _p: [u8; 3],
    pub slot: u64,
}

/// Season ranking (Arena content): private on the TEE; after the season only `root` is published.
#[account(zero_copy)]
pub struct Ranking {
    pub magic: u32,
    pub season: u32,
    pub used: u8,
    pub closed: u8,
    pub published: u8,
    pub issued: u8,
    pub _r: [u8; 4],
    pub root: [u8; 32],
    pub entries: [Entry; LB_SIZE],
}

#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub owner: Pubkey,
    pub season: u32,
    pub rank: u8,
    pub reward: u32,
}

/// In-game currency credited by claims (on Solana for now; requirement C6 is still open).
#[account]
#[derive(InitSpace)]
pub struct Wallet {
    pub owner: Pubkey,
    pub currency: u64,
}

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct InitSeason<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Season::INIT_SPACE, seeds = [b"season".as_ref(), &id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSeasonEnd<'info> {
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin)]
    pub season: Account<'info, Season>,
}

#[derive(Accounts)]
#[instruction(season: u32, shard: u16)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + core::mem::size_of::<Pool>(), seeds = [b"pool".as_ref(), &season.to_le_bytes(), &shard.to_le_bytes()], bump)]
    pub pool: AccountLoader<'info, Pool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct InitRanking<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + core::mem::size_of::<Ranking>(), seeds = [b"ranking".as_ref(), &season.to_le_bytes()], bump)]
    pub ranking: AccountLoader<'info, Ranking>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season: u32, shard: u16)]
pub struct InitPlayer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + core::mem::size_of::<Player>(), seeds = [b"player".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub player: AccountLoader<'info, Player>,
    #[account(init, payer = owner, space = 8 + core::mem::size_of::<RunSecret>(), seeds = [b"secret".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct InitSeasonSecret<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(has_one = admin, seeds = [b"season".as_ref(), &season.to_le_bytes()], bump)]
    pub season_acc: Account<'info, Season>,
    #[account(init, payer = admin, space = 8 + core::mem::size_of::<SeasonSecret>(), seeds = [b"season_secret".as_ref(), &season.to_le_bytes()], bump)]
    pub season_secret: AccountLoader<'info, SeasonSecret>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(season: u32)]
pub struct DelegateSecret<'info> {
    pub owner: Signer<'info>,
    /// CHECK: delegated PDA
    #[account(mut, del, seeds = [b"secret".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub run_secret: UncheckedAccount<'info>,
    /// CHECK: checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(season: u32)]
pub struct DelegateSeasonSecret<'info> {
    pub admin: Signer<'info>,
    #[account(has_one = admin, seeds = [b"season".as_ref(), &season.to_le_bytes()], bump)]
    pub season_acc: Account<'info, Season>,
    /// CHECK: delegated PDA
    #[account(mut, del, seeds = [b"season_secret".as_ref(), &season.to_le_bytes()], bump)]
    pub season_secret: UncheckedAccount<'info>,
    /// CHECK: checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct SecretPermission<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"secret".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, run_secret.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct SeasonSecretPermission<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(has_one = admin, seeds = [b"season".as_ref(), &season.to_le_bytes()], bump)]
    pub season_acc: Account<'info, Season>,
    #[account(mut, seeds = [b"season_secret".as_ref(), &season.to_le_bytes()], bump)]
    pub season_secret: AccountLoader<'info, SeasonSecret>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, season_secret.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetSeasonSecret<'info> {
    pub admin: Signer<'info>,
    #[account(has_one = admin)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [b"season_secret".as_ref(), &season.id.to_le_bytes()], bump)]
    pub season_secret: AccountLoader<'info, SeasonSecret>,
}

/// begin_run / retry_vrf: the player's accounts + the VRF request accounts (`#[vrf]` adds program_identity,
/// vrf_program, slot_hashes, system_program)
#[vrf]
#[derive(Accounts)]
pub struct BeginRun<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    #[account(seeds = [b"season_secret".as_ref(), &season.id.to_le_bytes()], bump)]
    pub season_secret: AccountLoader<'info, SeasonSecret>,
    pub season: Account<'info, Season>,
    /// CHECK: the ephemeral VRF queue
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE.to_bytes().into())]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// The VRF callback (`#[vrf_callback]` adds the scoped VRF identity signer)
#[vrf_callback]
#[derive(Accounts)]
pub struct VrfCallback<'info> {
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    pub season_secret: AccountLoader<'info, SeasonSecret>,
}

/// request_action / retry_request: the player's accounts, the pool shard + ranking (the fight's callback needs them),
/// and the VRF request accounts
#[vrf]
#[derive(Accounts)]
pub struct RequestAction<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    pub run_secret: AccountLoader<'info, RunSecret>,
    pub pool: AccountLoader<'info, Pool>,
    pub ranking: AccountLoader<'info, Ranking>,
    pub season: Account<'info, Season>,
    /// CHECK: the ephemeral VRF queue
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE.to_bytes().into())]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ApplyRandom<'info> {
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub ranking: AccountLoader<'info, Ranking>,
}

#[cfg(feature = "local")]
#[derive(Accounts)]
pub struct LocalApply<'info> {
    pub admin: Signer<'info>,
    pub season: Account<'info, Season>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub ranking: AccountLoader<'info, Ranking>,
}

#[cfg(feature = "local")]
#[derive(Accounts)]
pub struct LocalVrf<'info> {
    pub admin: Signer<'info>,
    pub season: Account<'info, Season>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    #[account(seeds = [b"season_secret".as_ref(), &season.id.to_le_bytes()], bump)]
    pub season_secret: AccountLoader<'info, SeasonSecret>,
}

#[derive(Accounts)]
pub struct JoinPool<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(season: u32)]
pub struct DelegatePlayer<'info> {
    pub owner: Signer<'info>,
    /// CHECK: delegated PDA
    #[account(mut, del, seeds = [b"player".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
    /// CHECK: checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(season: u32, shard: u16)]
pub struct DelegatePool<'info> {
    pub admin: Signer<'info>,
    /// CHECK: delegated PDA
    #[account(mut, del, seeds = [b"pool".as_ref(), &season.to_le_bytes(), &shard.to_le_bytes()], bump)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(season: u32)]
pub struct DelegateRanking<'info> {
    pub admin: Signer<'info>,
    /// CHECK: delegated PDA
    #[account(mut, del, seeds = [b"ranking".as_ref(), &season.to_le_bytes()], bump)]
    pub ranking: UncheckedAccount<'info>,
    /// CHECK: checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// program-owned again = the published copy on Solana
    #[account(seeds = [b"ranking".as_ref(), &season.to_le_bytes()], bump)]
    pub ranking: AccountLoader<'info, Ranking>,
    #[account(init, payer = owner, space = 8 + ClaimReceipt::INIT_SPACE, seeds = [b"claim".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub receipt: Account<'info, ClaimReceipt>,
    #[account(init_if_needed, payer = owner, space = 8 + Wallet::INIT_SPACE, seeds = [b"wallet".as_ref(), owner.key().as_ref()], bump)]
    pub wallet: Account<'info, Wallet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct PlayerPermission<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"player".as_ref(), &season.to_le_bytes(), owner.key().as_ref()], bump)]
    pub player: AccountLoader<'info, Player>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, player.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(season: u32, shard: u16)]
pub struct PoolPermission<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"pool".as_ref(), &season.to_le_bytes(), &shard.to_le_bytes()], bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, pool.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(season: u32)]
pub struct RankingPermission<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"ranking".as_ref(), &season.to_le_bytes()], bump)]
    pub ranking: AccountLoader<'info, Ranking>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, ranking.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
}

/// Signer (owner or session key) + their Player + RunSecret + Season (all checked against the player's).
#[derive(Accounts)]
pub struct PlayerSeason<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    pub season: Account<'info, Season>,
}

#[derive(Accounts)]
pub struct Fight<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub ranking: AccountLoader<'info, Ranking>,
    pub season: Account<'info, Season>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct CloseSeason<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [b"season".as_ref(), &season_id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [b"ranking".as_ref(), &season_id.to_le_bytes()], bump)]
    pub ranking: AccountLoader<'info, Ranking>,
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct IssueProof<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"ranking".as_ref(), &season_id.to_le_bytes()], bump)]
    pub ranking: AccountLoader<'info, Ranking>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
}

#[commit]
#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct FinalizePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"season".as_ref(), &season_id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut)]
    pub player: AccountLoader<'info, Player>,
    #[account(mut)]
    pub run_secret: AccountLoader<'info, RunSecret>,
}

#[commit]
#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct PublishRoot<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"ranking".as_ref(), &season_id.to_le_bytes()], bump)]
    pub ranking: AccountLoader<'info, Ranking>,
}

#[commit]
#[derive(Accounts)]
#[instruction(season_id: u32, shard: u16)]
pub struct ClearPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"season".as_ref(), &season_id.to_le_bytes()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [b"pool".as_ref(), &season_id.to_le_bytes(), &shard.to_le_bytes()], bump)]
    pub pool: AccountLoader<'info, Pool>,
}

#[error_code]
pub enum GameError {
    #[msg("bad status")]
    BadStatus,
    #[msg("action not allowed in this phase")]
    BadPhase,
    #[msg("action rejected by the game rules")]
    Rejected,
    #[msg("batch size")]
    BatchSize,
    #[msg("season is not running")]
    SeasonOver,
    #[msg("season is still running")]
    SeasonRunning,
    #[msg("pool shard is full")]
    PoolFull,
    #[msg("account layout / magic mismatch")]
    BadLayout,
    #[msg("account was written by another sim version")]
    SimVersion,
    #[msg("not the owner")]
    NotOwner,
    #[msg("wrong account")]
    BadAccount,
    #[msg("bad time")]
    BadTime,
    #[msg("player is not ranked")]
    NotRanked,
    #[msg("bad merkle proof")]
    BadProof,
    #[msg("the secret account is not private yet (zero-member permission missing)")]
    NotPrivate,
    #[msg("value does not match its commitment")]
    BadCommit,
    #[msg("a random action is pending: wait for it to be applied")]
    Pending,
    #[msg("this action has a random outcome: use request_action")]
    NeedsRequest,
    #[msg("not a request action")]
    BadAction,
    #[msg("callback for another request / run (duplicate or late): ignored")]
    StaleCallback,
    #[msg("randomness log full for this run")]
    LogFull,
}

