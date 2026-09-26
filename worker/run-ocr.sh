#!/bin/sh
# Runs the OCR worker next to this script. The service key comes from the
# environment (an EnvironmentFile in the unit, say), so it lives in one place
# and never in this file.
set -eu
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY to the Supabase service role key}"
export SUPABASE_SERVICE_ROLE_KEY
export OCR_BATCH="${OCR_BATCH:-6}"
exec python3 "$(dirname "$0")/ocr.py"
