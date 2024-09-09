/**
 * @namespace teregramm
 * @typedef User
 * @type Object
 * @property {Number}   id                           - Уникальный идентификатор этого пользователя или бота.
 *                                                     Это число может иметь более 32 значащих битов, и в некоторых языках программирования могут возникнуть
 *                                                     трудности с его интерпретацией.
 *                                                     Но он имеет не более 52 значащих битов, поэтому для хранения этого идентификатора можно безопасно
 *                                                     использовать 64-битное целое число или тип с плавающей запятой двойной точности.
 * @property {Boolean}  is_bot                       - True, если этот пользователь бот
 * @property {String}   first_name                   - Имя пользователя или бота
 * @property {String}  [last_name]                   - Фамилия пользователя или бота
 * @property {String}  [username]                    - Имя пользователя или бота
 * @property {String}  [language_code]               - Языковой тег IETF для языка пользователя.
 * @property {Boolean} [is_premium]                  - True, если этот пользователь является пользователем Telegram Premium
 * @property {Boolean} [added_to_attachment_menu]    - True, если этот пользователь добавил бота в меню вложений
 * @property {Boolean} [can_join_groups]             - True, можно ли бота приглашать в группы. Возвращается только в {@link getMe}.
 * @property {Boolean} [can_read_all_group_messages] - True, если для бота отключен режим конфиденциальности. Возвращается только в {@link getMe}
 * @property {Boolean} [supports_inline_queries]     - True, если бот поддерживает встроенные запросы. Возвращается только в {@link getMe}
 * @property {Boolean} [can_connect_to_business]     - True, можно ли подключить бота к учетной записи Telegram Business для получения его сообщений. Возвращается только в {@link getMe}
 */

/**
 * @namespace telegramm
 * @typedef Chat
 * @type Object
 * @property {Number}  id          - Уникальный идентификатор этого чата.
 *                                   Это число может иметь более 32 значащих битов, и в некоторых языках программирования могут возникнуть трудности с его интерпретацией.
 *                                   Но он имеет не более 52 значащих битов, поэтому 64-битное целое число со знаком или тип с плавающей запятой двойной точности безопасны для хранения этого идентификатора.
 * @property {String}  type        - Тип чата, может принимать значения “private”, “group”, “supergroup” or “channel”
 * @property {String} [title]      - Заголовок для супергрупп, каналов и групповых чатов.
 * @property {String} [username]   - Username, for private chats, supergroups and channels if available
 * @property {String} [first_name] - First name of the other party in a private chat
 * @property {String} [last_name]  - Last name of the other party in a private chat
 * @property {Boolean} [is_forum]  - True, if the supergroup chat is a forum (has topics enabled)
 */