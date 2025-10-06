# Repository Cleanup Documentation

## Overview

This PR (#32) provides complete documentation and analysis for cleaning up the shthed/capy repository.

## Problem Statement

- **3 open PRs** have merge conflicts with main
- **4 stale branches** from already-merged PRs need deletion

## What This PR Delivers

✅ **Complete Analysis** - Every branch and PR analyzed  
✅ **Resolution Strategies** - Detailed, file-by-file conflict resolution  
✅ **Concrete Examples** - Before/after code for PR #31  
✅ **Quick Reference** - Commands ready to copy/paste  
✅ **Visual Diagrams** - Branch structure and timeline views

## Documentation Files (924 lines)

### 🎯 Start Here

**[MAINTAINER_QUICK_START.md](./MAINTAINER_QUICK_START.md)** - 90 lines  
Quick commands and 20-minute action plan. Start here for fastest path to resolution.

### 📊 Understanding the Problem

**[BRANCH_STATE_DIAGRAM.md](./BRANCH_STATE_DIAGRAM.md)** - 154 lines  
Visual diagrams showing branch relationships, conflicts, and timelines.

**[BRANCH_CLEANUP_SUMMARY.md](./BRANCH_CLEANUP_SUMMARY.md)** - 160 lines  
Complete analysis with tables, checklists, and action items.

### 🔧 Resolving Conflicts

**[MERGE_CONFLICT_RESOLUTION.md](./MERGE_CONFLICT_RESOLUTION.md)** - 188 lines  
Detailed resolution strategies for all 3 PRs with explanation of conflict types.

**[PR31_CONFLICT_RESOLUTION_EXAMPLE.md](./PR31_CONFLICT_RESOLUTION_EXAMPLE.md)** - 332 lines  
Concrete before/after examples for each conflicting file in PR #31.

## Quick Summary

### Stale Branches → DELETE (4 branches)

```bash
git push origin --delete \
  codex/add-local-storage-auto-reload-for-drawings \
  codex/run-tests-on-app-functions-mdptn5 \
  codex/update-touch-pointer-handling-in-index.html \
  codex/update-touch-pointer-handling-in-index.html-nzppqn
```

### Open PRs → RESOLVE (3 PRs)

| PR | Branch | Files | Strategy |
|----|--------|-------|----------|
| #31 | codex/implement-image-generation-on-game-load | 3 | Merge ChatGPT + autosave |
| #30 | codex/run-tests-on-app-functions-wkhe6x | Multiple | Merge presets + autosave |
| #25 | codex/run-tests-on-app-functions | Multiple | Merge all features |

**Resolution principle:** Keep ALL features (additive merge, no deletions)

## Why These Conflicts Exist

Main branch has evolved with new features:
- ✨ Autosave & recovery
- ☁️ Cloud sync across tabs  
- 🤖 GitHub Actions workflow

Open PRs were created before these additions and add their own features:
- 🎨 ChatGPT integration & key manager (PR #31)
- 📊 Detail presets & region legend (PR #30)
- 🎭 Palette streamlining & docs (PR #25)

**All features are compatible** - just need to be merged together!

## Resolution Approach

For each PR:

1. **Checkout branch:** `git checkout <branch-name>`
2. **Merge main:** `git merge origin/main`
3. **Resolve conflicts:**
   - Storage constants: Keep both sets
   - Initialization calls: Execute all
   - Features: List everything
   - Documentation: Merge narratives
4. **Commit & push:** `git commit && git push`

## Example (PR #31)

**Before (conflict in index.html):**
```javascript
<<<<<<< HEAD
const OPENAI_KEY_STORAGE = "capycolour.openaiKey";
=======
const AUTOSAVE_STORAGE_KEY = "capy.autosave.v1";
>>>>>>> origin/main
```

**After (resolution):**
```javascript
const OPENAI_KEY_STORAGE = "capycolour.openaiKey";
const AUTOSAVE_STORAGE_KEY = "capy.autosave.v1";
```

Simple! Keep both. This pattern applies throughout.

## Time Required

| Task | Time | Risk |
|------|------|------|
| Delete 4 stale branches | 30s | 🟢 None |
| Resolve PR #31 | 5min | 🟡 Low |
| Resolve PR #30 | 5min | 🟡 Low |
| Resolve PR #25 | 5min | 🟡 Medium |
| Run tests | 2min | - |
| **Total** | **~20 min** | - |

## What Happens After

1. All 3 PRs show "mergeable" ✅ on GitHub
2. PRs can be merged in order: #31 → #30 → #25
3. Repository has clean branch history
4. No stale branches cluttering the repo
5. All features coexist happily

## Testing

After resolution, verify everything works:

```bash
npm test --silent
```

All Playwright tests should pass.

## FAQ

**Q: Will any code be deleted?**  
A: No! All resolutions are additive (combining features).

**Q: Are the features compatible?**  
A: Yes! They work on different parts of the codebase.

**Q: What if tests fail after resolution?**  
A: Unlikely, but the resolution can be reverted easily.

**Q: Can I automate this?**  
A: The patterns are documented, but manual verification is recommended.

**Q: Which PR should I start with?**  
A: PR #31 (newest, smallest gap from main).

## Repository State

```
Before:
- 9 remote branches
- 3 PRs blocked (conflicts)
- 4 stale branches

After:
- 5 remote branches (main + 4 active PRs)
- 3 PRs ready to merge
- Clean history
```

## Need Help?

1. Read **MAINTAINER_QUICK_START.md** for commands
2. Check **BRANCH_STATE_DIAGRAM.md** for visuals
3. See **PR31_CONFLICT_RESOLUTION_EXAMPLE.md** for examples
4. Review **MERGE_CONFLICT_RESOLUTION.md** for strategies

## Credits

- **Analysis:** Automated repository analysis
- **Documentation:** 5 comprehensive guides
- **Code Examples:** Concrete before/after snippets
- **Testing:** Playwright suite validation

## Next Steps for Maintainer

1. Review this README
2. Read MAINTAINER_QUICK_START.md
3. Delete 4 stale branches (30 seconds)
4. Resolve 3 PR conflicts (~15 minutes)
5. Run tests (2 minutes)
6. Merge PRs in order
7. Done! 🎉

---

**Ready to proceed?** Start with [MAINTAINER_QUICK_START.md](./MAINTAINER_QUICK_START.md)
