#!/bin/bash

# Ask user if they want to reset the ledger
echo "Do you want to reset the ledger? (y/n)"
read reset_choice

# Validator command
COMMAND="solana-test-validator"

# Add reset flag if confirmed
if [[ "$reset_choice" == "y" || "$reset_choice" == "Y" || "$reset_choice" == "yes" ]]; then
    COMMAND+=" -r"
    echo "The ledger will be reset."
else
    echo "The ledger will be preserved."
fi

# Add BPF programs
COMMAND+=" --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s ./mpl/mpl-token-metadata.so"
COMMAND+=" --bpf-program BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY ./mpl/mpl-bubblegum.so"
COMMAND+=" --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d ./mpl/mpl-core.so"

# Append any additional arguments passed to the script
for arg in "$@"
do
    COMMAND+=" $arg"
done

# Execute the command
echo "Executing: $COMMAND"
eval $COMMAND 

