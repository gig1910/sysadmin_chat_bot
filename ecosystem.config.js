module.exports = {
	apps: [{
		name: 'sysadmin_chat_bot',
		script: './index.mjs',
		env: {
			TOKEN: 'xxxxxx',
		},
		watch: ['*.js'],
		watch_delay: 1000
	}]
};
