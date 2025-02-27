module.exports = {
	apps: [{
		name: 'sysadmin_chat_bot',
		script: './index.mjs',
		env: {
			TOKEN:   '$TELEGRAMM_BOT_TOKEN',
			DB_HOST: '',
			DB_NAME: '',
			DB_PASS: '',
		    	DB_PORT: 5432,
		    	DB_USER: '',
			DEEPSEEK_API_KEYL: '$DEEPSEEK_API_KEY'
		},
		watch: ['*.js', '*.mjs'],
		ignore_watch : ["node_modules", "logs"],
		watch_delay: 1000
	}]
};
