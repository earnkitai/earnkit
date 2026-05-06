# EarnKit Contracts

This package is the canonical boundary for EarnKit smart contracts.

Today the backend still compiles from `apps/earn-backend/contract` so the existing deploy flow does not break. The same escrow source is mirrored here as `contracts/EarnKitEscrow.sol` so future distribution can publish versioned contract sources and ABIs from one package instead of copying contracts across apps.

Next steps before public distribution:

- Move Hardhat config and deployment scripts into this workspace.
- Publish generated ABI files from this package.
- Version deployed addresses per chain and environment.
- Keep app packages consuming contracts through this package, never through copied ABI/source files.
