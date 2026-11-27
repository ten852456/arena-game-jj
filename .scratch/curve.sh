cd "$(dirname "$0")/.."
npx tsx scripts/balance.ts ${1:-60} 3,6,9,12,15 --no-len > .scratch/curve.txt
awk '/^=== Day/ {day=$3} /^(knight|thornguard|assassin|duelist|berserker|pyro|witch|chrono) / {v[$1]=v[$1] sprintf(" d%s:%s", day, $NF)} /^(tank|burst|scaling|control) / && NF==5 {a[$1]=a[$1] sprintf(" d%s", day)} END {for (h in v) print h, v[h]}' .scratch/curve.txt
grep -E "beats .* (7[5-9]|[89][0-9])%" .scratch/curve.txt; grep -E "day [0-9]+: (tank|burst|scaling|control) beats" .scratch/curve.txt
