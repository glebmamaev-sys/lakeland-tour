#!/usr/bin/env bash
# Подключение поддомена к GitHub Pages. Запускать ПОСЛЕ того, как у регистратора добавлена DNS-запись:
#   CNAME  tour  →  glebmamaev-sys.github.io
# Запуск из папки app:  ./domain.sh            (домен по умолчанию tour.myserendib.com)
#                        ./domain.sh other.example.com
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="${1:-tour.myserendib.com}"
REPO="lakeland-tour"
OWNER="$(gh api user --jq .login)"
TARGET="$OWNER.github.io"

echo "→ проверяю DNS: $DOMAIN должен указывать на $TARGET"
CN="$(dig +short CNAME "$DOMAIN" | sed 's/\.$//')"
if [ "$CN" != "$TARGET" ]; then
  echo "   пока нет: CNAME = '${CN:-пусто}'. Добавьте запись у регистратора и подождите 5–30 минут."
  echo "   проверить:  dig +short CNAME $DOMAIN"
  exit 1
fi
echo "   ок"

echo "→ CNAME-файл в сборке (чтобы домен не слетал при переопубликации)"
echo "$DOMAIN" > public/CNAME
git add public/CNAME
git -c user.name="deploy" -c user.email="deploy@local" commit -qm "Custom domain $DOMAIN" || true

echo "→ домен в настройках Pages"
gh api -X PUT "repos/$OWNER/$REPO/pages" -f "cname=$DOMAIN" >/dev/null

echo "→ переопубликация с базовым путём / (сайт теперь в корне домена)"
VITE_BASE=/ ./deploy.sh

echo "→ жду сертификат HTTPS (GitHub выпускает его 1–15 минут)"
for i in $(seq 1 40); do
  STATE="$(gh api "repos/$OWNER/$REPO/pages" --jq '.https_certificate.state // "none"' 2>/dev/null || echo none)"
  [ "$STATE" = "approved" ] && break
  sleep 15
done
echo "   сертификат: $STATE"
if [ "$STATE" = "approved" ]; then
  gh api -X PUT "repos/$OWNER/$REPO/pages" -F https_enforced=true >/dev/null && echo "   HTTPS включён принудительно"
fi
echo
echo "Готово: https://$DOMAIN/"
echo "Старый адрес https://$TARGET/$REPO/ теперь перенаправляет на новый."
