const letters = ['aа', 'b6в', 'cс', 'd', 'eеё', 'f', 'g', 'hн', 'иiu', 'jй', 'kк', 'l', 'mм', 'n', 'oо0', 'pр', 'q', 'r', 's5', 'tт7', 'u', 'v', 'w', 'xх', 'yу', 'z', 'з3'];

/**
 * Генерация RegExp для набора слов на основании данных о возможной подмене букв
 * @param {String} words
 */
export function generateRegExp(words){
	const _words = (words || '').split('').map(el => {
		switch(el){
			case ' ':
				return '.*?\n?.*?';
			
			default:
				const l = letters.find(l => l.includes(el));
				return l ? `[${l}]` : el;
		}
	});
	return new RegExp(_words.join(''), 'igm');
}

export default {generateRegExp};