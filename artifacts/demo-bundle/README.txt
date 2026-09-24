ImportProof review bundle

accepted.csv: only rows satisfying the current inventory contract.
rejected.csv: every held source row with reasons; nothing silently dropped.
canonical.json: exact target values and source row numbers.
recipe.json: reviewed rules and manual corrections.
lineage.json: per-cell original, output and transformation explanations.
original.txt: immutable original bytes as UTF-8 text.
manifest.json: hashes, counts and conservation result.

CSV values beginning with formula characters are prefixed with an apostrophe. Use canonical.json for exact machine imports. A manual correction is an assertion by the reviewer, not verified external truth.

To replay with the source repository: npm run replay -- path/to/extracted-bundle
No AI credentials or API responses are included.
