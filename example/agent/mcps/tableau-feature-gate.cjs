class FeatureGateProvider {
	async isFeatureEnabled(featureName) {
		return ['authoring-tools', 'download-workbook'].includes(featureName);
	}
}

module.exports = { FeatureGateProvider };