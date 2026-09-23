#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
echo 'WARNING: Removes the satima-cms Compose PostgreSQL volume and ALL its databases.'
echo 'Existing host PostgreSQL/MySQL installations are not affected. Back up first.'
read -r -p 'Type DELETE SATIMA to continue: ' answer
[[ "$answer" == 'DELETE SATIMA' ]] || { echo 'Cancelled'; exit 1; }
compose down --volumes
compose up -d --wait
bash database/scripts/migrate.sh
