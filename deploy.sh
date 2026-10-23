#!/usr/bin/env bash
# Публикация тура на GitHub Pages: https://<аккаунт>.github.io/lakeland-tour/
# Запуск из папки app:  ./deploy.sh
# Нужен авторизованный gh (gh auth status). Создаёт публичный репозиторий lakeland-tour при первом запуске,
# пушит исходники в main и сборку в gh-pages, включает Pages.
set -euo pipefail
cd "$(dirname "$0")"

REPO="lakeland-tour"
OWNER="$(gh api user --jq .login)"
BASE="/$REPO/"

echo "→ сборка под $BASE"
VITE_BASE="$BASE" npm run build >/dev/null
touch dist/.nojekyll

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "→ создаю публичный репозиторий $OWNER/$REPO и пушу исходники"
  gh repo create "$REPO" --public --source=. --remote=origin --push \
    --description "Lake Land (Sri Lanka) villas - 3D virtual walkthrough"
else
  echo "→ пушу исходники (main)"
  git push -u origin main
fi

echo "→ публикую сборку в ветку gh-pages"
rm -rf .deploy-tmp
git worktree prune
git worktree add --detach .deploy-tmp >/dev/null
( cd .deploy-tmp && git checkout -q --orphan gh-pages && git rm -rfq . >/dev/null 2>&1 || true
  cp -R ../dist/. . && git add -A
  git -c user.name="deploy" -c user.email="deploy@local" commit -qm "deploy $(date +%F_%H%M)"
  git push -f origin gh-pages )
git worktree remove --force .deploy-tmp

echo "→ включаю GitHub Pages (ветка gh-pages)"
gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null

URL="https://$OWNER.github.io/$REPO/"
echo "→ ждём, пока Pages соберёт сайт (обычно 30–90 с)"
for i in $(seq 1 30); do
  if curl -fsI "$URL" >/dev/null 2>&1; then break; fi
  sleep 5
done
echo
echo "Готово: $URL"
