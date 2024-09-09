module.exports = {
	apps: [{
		name: 'cams_notifier',
		script: './index.mjs',
		env: {
			TOKEN: 'xxxxxx',
		},
		watch: ['*.js'],
		watch_delay: 1000
	}]
};
