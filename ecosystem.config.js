module.exports = {
	apps: [{
		name: 'sysadmin_chat_bot',
		script: './index.mjs',
		env: {
			TOKEN: 'xxxxxx',
			DB_HOST: '',
			DB_NAME: '',
			DB_PASS: '',
		    DB_PORT: 5432,
		    DB_USER: ''
		},
		watch: ['*.js'],
		watch_delay: 1000
	}]
};
