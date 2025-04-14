#!/bin/bash

# Set output file name
OUTPUT_FILE="combined.rs.txt"

# Remove existing output file if it exists
[ -f "$OUTPUT_FILE" ] && rm "$OUTPUT_FILE"

# Find all .rs files recursively and process them
find . -type f -name "*.rs" | while read -r file; do
    # Add header with filename
    echo "// ---- Start of $file ----" >> "$OUTPUT_FILE"
    # Add the file contents
    cat "$file" >> "$OUTPUT_FILE"
    # Add footer and newline for separation
    echo -e "// ---- End of $file ----\n" >> "$OUTPUT_FILE"
done

echo "All .rs files have been concatenated into $OUTPUT_FILE"


