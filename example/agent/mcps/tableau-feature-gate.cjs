class FeatureGateProvider {
	async isFeatureEnabled(featureName) {
		return featureName === 'authoring-tools';
	}
}

module.exports = { FeatureGateProvider };