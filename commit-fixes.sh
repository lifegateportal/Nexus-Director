#!/bin/bash
# Commit pending bug fixes for ebook pipeline

cd /workspaces/Nexus-Director

echo "=== Committing apply-audit speaker progression fix ==="
git add app/api/ebook/apply-audit/route.ts
git commit -m "fix(audit): preserve speaker's natural progression from transcript

- Change duplicate detection to 98% verbatim threshold (was conceptual similarity)
- Only delete copy-paste errors, preserve intentional pedagogical reinforcement
- Add Jaccard similarity calculation for text comparison
- Surgical section rewrites maintain 98-102% word count (was 92-108%)
- Remove orphaned prompt fragments that caused build errors"

echo -e "\n=== Committing assign-segments defensive validation ==="
git add app/api/ebook/assign-segments/route.ts
git commit -m "fix(assign-segments): add defensive validation and detailed error logging

- Validate chapter.sections arrays before processing
- Add defensive guards for section properties (sourceSegmentIds, quotesInSection, keyPoints)
- Wrap section processing in try-catch with chapter/section context
- Add comprehensive console logging for debugging
- Include stack traces in 500 error responses"

echo -e "\n=== Pushing both commits ==="
git push

echo -e "\n=== Done! ==="
