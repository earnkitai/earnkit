#!/bin/zsh
# Runs one repro script against the local instance in REPRO_BASE_URL (default http://localhost:4600) and the database in
# REPRO_DATABASE_URL (default earnkit_journeys). lib.mts refuses a target that is not this machine (see README.md).
DIR=${0:A:h}
FRONTEND=${DIR:h:h}
export REPRO_BASE_URL=${REPRO_BASE_URL:-http://localhost:4600}
export REPRO_DATABASE_URL=${REPRO_DATABASE_URL:-postgresql://localhost:5432/earnkit_journeys}
export REPRO_AUTH_SECRET=${REPRO_AUTH_SECRET:-journeys-local-secret-not-for-prod-0123456789abcdef}
export REPRO_CRON_SECRET=${REPRO_CRON_SECRET:-journeys-cron-secret}
# The in-process helpers (sessions, CSRF, programs) read the app's own names.
export DATABASE_URL=$REPRO_DATABASE_URL EARNKIT_URL=$REPRO_BASE_URL EARNKIT_AUTH_SECRET=$REPRO_AUTH_SECRET CRON_SECRET=$REPRO_CRON_SECRET
cd $FRONTEND
exec ${FRONTEND:h:h}/node_modules/.bin/tsx "$@"
