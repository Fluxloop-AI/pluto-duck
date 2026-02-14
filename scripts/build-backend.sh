#!/bin/bash
set -euo pipefail

echo "scripts/build-backend.sh is deprecated in remove-python."
echo "Python/PyInstaller backend packaging was removed."
echo "Use one of the following instead:"
echo "  - ./scripts/build-frontend-server.sh"
echo "  - ./scripts/build.sh"
echo "  - ./scripts/build-signed.sh"
exit 1
