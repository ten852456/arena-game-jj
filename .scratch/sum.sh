#!/usr/bin/env bash
# compact balance summary: per-hero overall per day + misses count. usage: sum.sh N [days]
cd "$(dirname "$0")/.."
N=${1:-20}; D=${2:-3,5,10,13}
npx tsx scripts/balance.ts $N $D --no-len > .scratch/last_bal.txt 2>&1
awk '
/^=== Day/ {day=$3}
/^(tank|burst|scaling|control) / && NF==5 {arch[day]=arch[day] sprintf(" %s:%s/%s/%s/%s", substr($1,1,4),$2,$3,$4,$5)}
/^(knight|thornguard|assassin|duelist|berserker|pyro|witch|chrono) / {v[$1,day]=$NF; heroes[$1]=1; days[day]=1}
/Hero spread/ {sp[day]=$7}
/targets missed|All targets/ {miss=$0}
END {
  printf "%-11s", "hero"; for (d in days) ds[++n]=d; asort(ds); for(i=1;i<=n;i++) printf "%7s", "d" ds[i]; print "";
  split("knight thornguard assassin duelist berserker pyro witch chrono", H, " ");
  for (h=1; h<=8; h++) { printf "%-11s", H[h]; for(i=1;i<=n;i++) printf "%7s", v[H[h],ds[i]]; print "" }
  printf "%-11s", "spread"; for(i=1;i<=n;i++) printf "%7s", sp[ds[i]]; print "";
  print miss
}' .scratch/last_bal.txt
grep -E "^\s+day" .scratch/last_bal.txt | grep -v spread | head -40
