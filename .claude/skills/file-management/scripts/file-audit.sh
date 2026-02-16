#!/usr/bin/env bash
# file-audit.sh — Check file organization in the Notesnook monorepo
# Usage: bash .claude/skills/file-management/scripts/file-audit.sh [directory]

set -euo pipefail

TARGET_DIR="${1:-.}"
WARNINGS=0
ERRORS=0

# Directories to skip during audit
PRUNE_DIRS=".git .github .vscode .idea .claude node_modules dist build .next .nuxt .turbo .vercel .taskcache .nx coverage .nyc_output .husky fastlane android ios Pods"

# Same-family file extension sets (files with these extensions should coexist)
SAME_FAMILY_SETS=("ts,tsx,d.ts,mts,cts" "js,jsx,mjs,cjs")

# Paths exempt from audit warnings
EXEMPT_PATTERNS="docs/help|_include|__fixtures__|__mocks__"

# Build the prune expression for find
PRUNE_EXPR=""
for dir in $PRUNE_DIRS; do
  if [ -n "$PRUNE_EXPR" ]; then
    PRUNE_EXPR="$PRUNE_EXPR -o"
  fi
  PRUNE_EXPR="$PRUNE_EXPR -name $dir"
done

echo "=== File Audit Report ==="
echo "Target: $TARGET_DIR"
echo ""

# --- Check 1: Orphan source files at root ---
echo "--- Check 1: Orphan source files at root ---"
ORPHANS=$(find "$TARGET_DIR" -maxdepth 1 -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) 2>/dev/null | grep -v node_modules || true)
if [ -n "$ORPHANS" ]; then
  echo "WARNING: Source files found at repo root (should be in a package):"
  echo "$ORPHANS" | while read -r f; do echo "  $f"; done
  WARNINGS=$((WARNINGS + 1))
else
  echo "OK: No orphan source files at root."
fi
echo ""

# --- Check 2: Empty directories (excluding exempt) ---
echo "--- Check 2: Empty directories ---"
EMPTY_DIRS=$(find "$TARGET_DIR" \( $PRUNE_EXPR \) -prune -o -type d -empty -print 2>/dev/null | grep -vE "$EXEMPT_PATTERNS" || true)
if [ -n "$EMPTY_DIRS" ]; then
  echo "INFO: Empty directories found:"
  echo "$EMPTY_DIRS" | while read -r d; do echo "  $d"; done
else
  echo "OK: No unexpected empty directories."
fi
echo ""

# --- Check 3: Stray .env files ---
echo "--- Check 3: Stray .env files ---"
ENV_FILES=$(find "$TARGET_DIR" \( $PRUNE_EXPR \) -prune -o -name ".env*" -type f -print 2>/dev/null || true)
if [ -n "$ENV_FILES" ]; then
  echo "WARNING: .env files found (should not be committed):"
  echo "$ENV_FILES" | while read -r f; do echo "  $f"; done
  WARNINGS=$((WARNINGS + 1))
else
  echo "OK: No .env files found."
fi
echo ""

# --- Check 4: Large files (>1MB) ---
echo "--- Check 4: Large files (>1MB, excluding media/binaries) ---"
LARGE_FILES=$(find "$TARGET_DIR" \( $PRUNE_EXPR \) -prune -o -type f -size +1M \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" \) -print 2>/dev/null || true)
if [ -n "$LARGE_FILES" ]; then
  echo "INFO: Large source/doc files found:"
  echo "$LARGE_FILES" | while read -r f; do echo "  $f ($(du -h "$f" | cut -f1))"; done
else
  echo "OK: No unusually large source files."
fi
echo ""

# --- Check 5: Files outside expected structure ---
echo "--- Check 5: Source files outside expected structure ---"
STRAY_FILES=$(find "$TARGET_DIR" \( $PRUNE_EXPR \) -prune -o -type f \( -name "*.ts" -o -name "*.tsx" \) -print 2>/dev/null | grep -vE "^$TARGET_DIR/(apps|packages|extensions|servers|scripts)/" | grep -vE "$EXEMPT_PATTERNS" | grep -vE "\.(config|setup)\.(ts|js)$" | grep -vE "tsconfig" || true)
if [ -n "$STRAY_FILES" ]; then
  echo "WARNING: TypeScript files outside expected directories:"
  echo "$STRAY_FILES" | while read -r f; do echo "  $f"; done
  WARNINGS=$((WARNINGS + 1))
else
  echo "OK: All TypeScript files are in expected directories."
fi
echo ""

# --- Summary ---
echo "=== Summary ==="
echo "Warnings: $WARNINGS"
echo "Errors: $ERRORS"

if [ $ERRORS -gt 0 ]; then
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo "Review warnings above."
  exit 0
else
  echo "All checks passed."
  exit 0
fi
