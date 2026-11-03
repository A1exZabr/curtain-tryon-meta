#!/bin/sh
# Runs the evaluation once per stage variant, two at a time, each in a CPU-limited container, and leaves
# eval/RESULTS-<variant>.md and out/ablation/<variant>/headline.json behind.
# Usage (in a copy of the repo, with the API keys in ENV_FILE): ENV_FILE=/path/.env sh ops/ablation.sh raw paste light design full
set -e
run() {
  docker run --rm --cpus 1.5 --memory 2g -v "$PWD":/app -w /app --env-file "$ENV_FILE" \
    -e SPEND_FILE=/app/data/eval-spend-$1.json -e SPEND_CAP_USD_PER_DAY=4 node:24-slim \
    npx tsx eval/run.ts --parallel 3 --variant "$1" --out "out/ablation/$1" --results "eval/RESULTS-$1.md" > "out/ablation-$1.log" 2>&1
}
mkdir -p out/ablation
docker run --rm -v "$PWD":/app -w /app node:24-slim npm ci --no-audit --no-fund > /dev/null 2>&1
while [ $# -gt 0 ]; do
  run "$1" &
  if [ $# -gt 1 ]; then run "$2" & shift; fi
  shift
  wait
done
