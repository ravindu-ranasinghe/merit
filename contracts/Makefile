-include .env
export

ARC_USDC     := 0x3600000000000000000000000000000000000000
ARC_EXPLORER := https://explorer.testnet.arc.io

.PHONY: build test coverage deploy-arc verify-arc abi

build:
	forge build

test:
	forge test -vv

coverage:
	forge coverage --no-match-coverage 'test|script'

# Deploy + verify on Arc testnet (Blockscout verifier). Needs ARC_RPC_URL and DEPLOYER_PRIVATE_KEY in .env.
deploy-arc:
	forge script script/Deploy.s.sol:Deploy --rpc-url $(ARC_RPC_URL) --private-key $(DEPLOYER_PRIVATE_KEY) \
		--broadcast --verify --verifier blockscout --verifier-url $(ARC_EXPLORER)/api/

# Re-run verification alone if the deploy's verify step failed. Needs ESCROW_ADDRESS.
verify-arc:
	forge verify-contract $(ESCROW_ADDRESS) src/BountyEscrow.sol:BountyEscrow --chain-id 5042002 \
		--constructor-args $(shell cast abi-encode 'constructor(address)' $(ARC_USDC)) \
		--verifier blockscout --verifier-url $(ARC_EXPLORER)/api/

# Regenerate the ABI teammates consume.
abi: build
	jq '.abi' out/BountyEscrow.sol/BountyEscrow.json > ../docs/escrow-abi.json
