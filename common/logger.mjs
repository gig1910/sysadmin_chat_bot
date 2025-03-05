import fs from 'fs/promises';
import {constants} from 'fs';

let log_lev = 9;
let log_file = './logs/log.txt';

/**
 * Установка уровня логгирования
 * @param {Number|String} [logLev=1]
 * @public
 * @export
 */
export function setLogLev(logLev){
	log_lev = parseInt(logLev, 10) || 1;
	console.info(`Установлен уровень логгирования: ${logLev}`);
}

/**
 * Установка имени лог файла
 * @param {String} fileName
 * @public
 * @export
 * @async
 */
export async function setLogFile(fileName){
	log_file = typeof (fileName) === 'string' ?
	             fileName || `log_${(new Date()).toISOString().substring(0, 19).replace('T', '_')}.txt`
	           : `log_${(new Date()).toISOString().substring(0, 19).replace('T', '_')}.txt`;
	
	console.info(`Установлен лог-файл: ${fileName}`);
	
	if(await fileAccess(fileName)){
		await rotateFileLogName(log_file);
	}
}

/**
 * Проверка файла на доступность на запись
 * @param {String} fileName
 * @async
 * @returns {Boolean}
 */
async function fileAccess(fileName){
	if(!fileName){
		throw new Error(`Не передано имя файла`);
	}
	
	try{
		await fs.access(fileName, constants.W_OK);
		return true;
		
	}catch(err){
		// console.info(err); // Ошибка проверки существования файла - значит его нет
		return false;
	}
}

/**
 * Переименование файла
 * @param {String} fileName
 * @param {String} newFileName
 * @async
 * @returns {Boolean}
 */
async function fileRename(fileName, newFileName){
	if(await fileAccess(fileName)){
		if(!(await fileAccess(newFileName))){
			try{
				return fs.rename(fileName, newFileName);
				
			}catch(err){
				console.error(err);
			}
			
		}else{
			throw new Error(`Файл ${fileName} существует`);
		}
		
	}else{
		throw new Error(`Файл ${fileName} не доступен`);
	}
}

/**
 * строка - это целочисленное число?
 * @param {String} str
 * @returns {Boolean}
 */
function isNum(str){
	let _n = parseInt(str, 10);
	return !Number.isNaN(_n) && _n.toString() === str;
}

/**
 * Получаем базовое имя файла без цифрового постфикса
 * @param {String} fileName
 * @returns {String}
 */
function getBaseFileName(fileName){
	if(typeof (fileName) === 'string'){
		let _arr = fileName.split('.');
		let ext = _arr.pop();
		
		//Собираем базовое имя файла
		return isNum(ext) ? _arr.join('.') : _arr.concat(ext).join('.');
		
	}else{
		return '';
	}
}

/**
 * Функция ротации логов. Все логи и одинаковым именем переименовываются с добавлением цифрового постфикса. В порядке возрастания.
 * Если есть пересечение по имени, то происходил цепочечное переименовывание
 * @param {String}           fileName
 * @param {?Number/?String} [index]
 * @param {?String}         [baseFileName]
 * @returns {Promise<Boolean>}
 */
async function rotateFileLogName(fileName, index, baseFileName){
	index = parseInt(index, 10) || 1;
	
	baseFileName = baseFileName || getBaseFileName(fileName);
	
	if((await fileAccess(`${baseFileName}.${index}`))){
		await rotateFileLogName(`${baseFileName}.${index}`, index + 1, baseFileName);
	}
	
	return fileRename(fileName, `${baseFileName}.${index}`);
}

/**
 * Запись в лог файл
 * @returns {Promise<Boolean>}
 * @private
 */
async function write2LogFile(message){
	let _fd;
	try{
		_fd = await fs.open(log_file, 'a');
		if(message){
			await fs.writeFile(_fd, `${String(message)}\n`);
		}
		
		await _fd.close();
		_fd = undefined;
		
	}catch(err){
		console.error(err);
		
	}finally{
		_fd?.close();
	}
}

export async function err(err){
	console.error(err);
	await write2LogFile(`${(new Date()).toISOString()}: ERR   : ${err?.message || err?.description}`);
	return write2LogFile(`${JSON.stringify(err)}`);
}

export async function warn(message, obj){
	if(log_lev > 0){
		console.warn(message);
		await write2LogFile(`${(new Date()).toISOString()}: WARN  : ${message}`);
		return arguments.length > 1 ? dir(obj) : true;
	}
}

export async function info(message, obj){
	if(log_lev > 1){
		console.info(message);
		await write2LogFile(`${(new Date()).toISOString()}: INFO  : ${message}`);
		return arguments.length > 1 ? dir(obj) : true;
	}
}

export async function log(message, obj){
	if(log_lev > 2){
		console.log(message);
		await write2LogFile(`${(new Date()).toISOString()}: LOG   : ${message}`);
		return arguments.length > 1 ? dir(obj) : true;
	}
}

export async function trace(message, obj){
	if(log_lev > 3){
		console.log(message);
		await write2LogFile(`${(new Date()).toISOString()}: TRACE : ${message}`);
		return arguments.length > 1 ? dir(obj) : true;
	}
}

export async function trace1(message, obj){
	if(log_lev > 4){
		console.log(message);
		await write2LogFile(`${(new Date()).toISOString()}: TRACE1: ${message}`);
		return arguments.length > 1 ? dir(obj) : true;
	}
}

export async function trace2(message, obj){
	if(log_lev > 5){
		console.log(message);
		await write2LogFile(`${(new Date()).toISOString()}: TRACE2: ${message}`);
		return arguments.length > 1 ? dir(obj) : true;
	}
}

export async function dir(obj){
	if(log_lev > 6){
		console.dir(obj);
		return write2LogFile(`${(new Date()).toISOString()}: OBJECT: ${JSON.stringify(obj)}`);
	}
}

setLogLev(log_lev);
(async () => await setLogFile(log_file) )();

export default {
	setLogFile: setLogFile,
	setLogLev:  setLogLev,
	err:        err,
	warn:       warn,
	info:       info,
	log:        log,
	trace:      trace,
	trace1:     trace1,
	trace2:     trace2,
	dir:        dir
};
