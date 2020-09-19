'use strict';

/**
 * Hyperledger Fabric network helper methods
 */

const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');
const { buildCCPOrg1, buildWallet } = require('./AppUtil.js');
const { buildCAClient } = require('./CAUtil.js');

// build an in memory object with the network configuration (also known as a connection profile)
const ccp = buildCCPOrg1();

// the wallet to hold the credentials of the application users
let wallet = undefined

// wallet initialization
exports.initWallet = async () => {

	// build new in-memory wallet
	wallet = await buildWallet(Wallets);

	// return a reference to the wallet
	return wallet;
};

// build an instance of the fabric ca services client based on
// the information in the network configuration
exports.getCaClient = () => {
	return buildCAClient(FabricCAServices, ccp, 'ca.org1.example.com');
};

// Create a new gateway instance for interacting with the fabric network.
// In a real application this would be done as the backend server session is setup for
// a user that has been verified.
const gateway = new Gateway();

exports.getContract = async (username) => {
    // setup the gateway instance
	// The user will now be able to create connections to the fabric network and be able to
	// submit transactions and query. All transactions submitted by this gateway will be
	// signed by this user using the credentials stored in the wallet.
	await gateway.connect(ccp, {
		wallet,
		identity: username,
		discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
	});

	// Build a network instance based on the channel where the smart contract is deployed
	const network = await gateway.getNetwork('mychannel');

	// Get the contract from the network.
	const contract = network.getContract('prototype');

	return contract;
};