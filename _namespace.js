/**
 * @namespace teregram
 * @typedef Update
 * @type Object
 * @property {Message}        [message]
 * @property {Edited_Message} [edited_message]
 * @property {Callback_Query} [callback_query]
 * @property {Number}          update_id
 *
 */

/**
 * @namespace teregram
 * @typedef Message
 * @type Object
 * @property {Number}               [forward_from_message_id]
 * @property {Forward_Origin}       [forward_origin]
 * @property {From}                 [forward_from]
 * @property {Sticker}              [sticker]
 * @property {Chat}                 [forward_from_chat]
 * @property {Number}               [message_thread_id]
 * @property {Number}               [forward_date]
 * @property {Number}                date
 * @property {Animation}            [animation]
 * @property {Photo[]}              [photo]
 * @property {Quote}                [quote]
 * @property {Voice}                [voice]
 * @property {From}                  from
 * @property {From}                 [new_chat_participant]
 * @property {String}                caption
 * @property {Chat}                  chat
 * @property {From}                 [new_chat_member]
 * @property {Boolean}              [is_from_offline]
 * @property {From[]}               [new_chat_members]
 * @property {Video}                [video]
 * @property {String}                text
 * @property {Message}              [reply_to_message]
 * @property {Reply_Markup}         [reply_markup]
 * @property {Caption_Entities}     [caption_entities]
 * @property {Pinned_Message}       [pinned_message]
 * @property {Number}               [media_group_id]
 * @property {Entity[]}             [entities]
 * @property {Link_Preview_Options} [link_preview_options]
 * @property {Number}                message_id
 * @property {Document}             [document]
 */

/**
 * @namespace teregram
 * @typedef Edited_Message
 * @type Object
 * @property {Number}  edit_dat
 * @property {Number}  date
 * @property {From}    from
 * @property {From}   [new_chat_participan]
 * @property {Chat}    chat
 * @property {From}   [new_chat_member]
 * @property {From[]} [new_chat_members]
 * @property {String}  text
 * @property {Number}  message_id
 */

/**
 * @namespace teregram
 * @typedef Callback_Query
 * @type Object
 * @property {Number}  chat_instance
 * @property {Number}  id
 * @property {Number}  from
 * @property {Number}  data
 * @property {Message} message
 */

/**
 * @namespace teregram
 * @typedef Forward_Origin
 * @type Object
 * @property {Number}  date
 * @property {String}  type
 * @property {From}    sender_user
 * @property {Chat}    chat
 * @property {Number}  message_id
 */

/**
 * @namespace teregram
 * @typedef Sticker
 * @type Object
 * @property {String}    set_name
 * @property {Number}    file_size
 * @property {String}    emoji
 * @property {Boolean}   is_animated
 * @property {Number}    height
 * @property {Thumbnail} thumbnail
 * @property {Thumbnail} thumb
 * @property {Number}    width
 * @property {String}    file_id
 * @property {String}    file_unique_id
 * @property {String}    type
 * @property {Boolean}   is_video
 */

/**
 * @namespace teregram
 * @typedef Thumbnail
 * @type Object
 * @property {Number}  file_siz
 * @property {Number}  height
 * @property {Number}  width
 * @property {String}  file_id
 * @property {String}  file_unique_id
 */

/**
 * @namespace teregram
 * @typedef Chat
 * @type Object
 * @property {Number}  id
 * @property {String}  type
 * @property {String}  title
 * @property {String}  username
 * @property {String}  [last_name]
 * @property {String}  [first_name]
 *
 */

/**
 * @namespace teregram
 * @typedef Animation
 * @type Object
 * @property {String}     file_name
 * @property {String}     mime_type
 * @property {Number}     file_size
 * @property {Number}     height
 * @property {Thumbnail}  thumbnail
 * @property {Thumbnail}  thumb
 * @property {Number}     width
 * @property {String}     file_id
 * @property {String}     file_unique_id
 * @property {Number}     duration
 */

/**
 * @namespace teregram
 * @typedef From
 * @type Object
 * @property {Number}  id
 * @property {Boolean} is_bot
 * @property {Boolean} [is_premium]
 * @property {String}  username
 * @property {String}  first_name
 * @property {String}  [last_name]
 * @property {String}  [language_code]
 */

/**
 * @namespace teregram
 * @typedef BotInfo
 * @type Object
 * @property {Number}   id
 * @property {Boolean}  is_bot
 * @property {?Boolean} can_read_all_group_messages
 * @property {?Boolean} has_main_web_app
 * @property {?Boolean} can_join_groups
 * @property {?Boolean} supports_inline_queries
 * @property {?Boolean} can_connect_to_business
 * @property {String}   username
 * @property {String}   first_name
 * @property {String}   language_code
 */

/**
 * @namespace teregram
 * @typedef Telegram
 * @type Object
 * @property {String} token
 * @property {{testEnv: Boolean, agent: Object, apiRoot: String, webhookReply: Boolean, apiMode: String}} options
 */

/**
 * @namespace teregram
 * @typedef Photo
 * @type Object
 * @property {Number}  file_size
 * @property {Number}  height
 * @property {Number}  width
 * @property {String}  file_id
 * @property {String}  file_unique_id
 */

/**
 * @namespace teregram
 * @typedef Quote
 * @type Object
 * @property {Number}  position
 * @property {String}  text
 * @property {Boolean} is_manual
 */

/**
 * @namespace teregram
 * @typedef Voice
 * @type Object
 * @property {String}  mime_type
 * @property {Number}  file_size
 * @property {String}  file_id
 * @property {String}  file_unique_id
 * @property {Number} duration
 */

/**
 * @namespace teregram
 * @typedef Video
 * @type Object
 * @property {String}    mime_type
 * @property {Number}    file_size
 * @property {Number}    height
 * @property {Thumbnail} thumbnail
 * @property {Thumbnail} thumb
 * @property {Number}    width
 * @property {String}    file_id
 * @property {String}    file_unique_id
 * @property {Number}    duration
 */

/**
 * @namespace teregram
 * @typedef Reply_Markup
 * @type Object
 * @property {Array}    inline_keyboard
 */

/**
 * @namespace teregram
 * @typedef Caption_Entities
 * @type Object
 * @property {Number} length
 * @property {Number} offset
 * @property {String} type
 * @property {String} [url]
 * @property {Number} [custom_emoji_id]
 */

/**
 * @namespace teregram
 * @typedef Pinned_Message
 * @type Object
 * @property {Number}    edit_date
 * @property {Number}    date
 * @property {From}      from
 * @property {Chat}      chat
 * @property {String}    text
 * @property {Entity[]} [entities]
 * @property {Number}    message_id
 */

/**
 * @namespace teregram
 * @typedef Entity
 * @type Object
 * @property {Number} length
 * @property {Number} offset
 * @property {String} type
 */

/**
 * @namespace teregram
 * @typedef Document
 * @type Object
 * @property {String}    file_name
 * @property {String}    mime_type
 * @property {Number}    file_size
 * @property {Thumbnail} thumbnail
 * @property {Thumbnail} thumb
 * @property {String}    file_id
 * @property {String}    file_unique_id
 */

/**
 * @namespace teregram
 * @typedef Link_Preview_Options
 * @type Object
 * @property {Boolean} prefer_large_media
 * @property {Boolean} is_disabled
 * @property {String}  url
 */

/**
 * @namespace teregram
 * @typedef CTX
 * @class
 * @property {Object}   state
 * @property {Update}   update
 * @property {String}   [command]
 * @property {Array}    [args]
 * @property {String}   [payload]
 * @property {String[]} [match]
 * @property {?BotInfo} botInfo
 * @property {Telegram} telegram
 */

/**
 * @method
 * @name CTX#deleteMessage
 * @param {Number} message_id
 * @async
 * @return {Promise<Boolean>}
 */

/**
 * @method
 * @name CTX#reply
 * @param {String} message
 * @param {Object} [option]
 * @async
 * @return {Promise<Message.TextMessage>}
 */

/**
 * @method
 * @name CTX#sendMessage
 * @param {String} message
 * @param {{parse_mode?: String, reply_to_message_id?: Number}} [option]
 * @async
 * @return {Promise<Message.TextMessage>}
 */

