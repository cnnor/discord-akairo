const { ArgumentMatches } = require('../../util/Constants');

/*
 * Grammar:
 *
 * Arguments
 *  = (Argument (WS? Argument)*)? EOF
 *
 * Argument
 *  = Flag
 *  | Phrase
 *
 * Flag
 *  = FlagWord
 *  | OptionFlagWord WS? Phrase?
 *
 * Phrase
 *  = Quote (Word | WS)* Quote?
 *  | OpenQuote (Word | OpenQuote | Quote | WS)* EndQuote?
 *  | EndQuote
 *  | Word
 *
 * FlagWord = Given
 * OptionFlagWord = Given
 * Quote = "
 * OpenQuote = “
 * EndQuote = ”
 * Word = /^\S+/ (and not in FlagWord or OptionFlagWord)
 * WS = /^\s+/
 * EOF = /^$/
 *
 * With a separator:
 *
 * Arguments
 *  = (Argument (WS? Separator WS? Argument)*)? EOF
 *
 * Argument
 *  = Flag
 *  | Phrase
 *
 * Flag
 *  = FlagWord
 *  | OptionFlagWord WS? Phrase?
 *
 * Phrase
 *  = Word (WS Word)*
 *
 * FlagWord = Given
 * OptionFlagWord = Given
 * Seperator = Given
 * Word = /^\S+/ (and not in FlagWord or OptionFlagWord or equal to Seperator)
 * WS = /^\s+/
 * EOF = /^$/
 */

class Tokenizer {
    constructor(content, {
        flagWords = [],
        optionFlagWords = [],
        quoted = true,
        separator
    } = {}) {
        this.content = content;
        this.flagWords = flagWords;
        this.optionFlagWords = optionFlagWords;
        this.quoted = quoted;
        this.separator = separator;
        this.position = 0;
        // 0 -> Default, 1 -> Quotes (""), 2 -> Special Quotes (“”)
        this.state = 0;
        this.tokens = [];
    }

    startsWith(str) {
        return this.content.slice(this.position, this.position + str.length).toLowerCase() === str.toLowerCase();
    }

    match(regex) {
        return this.content.slice(this.position).match(regex);
    }

    slice(from, to) {
        return this.content.slice(this.position + from, this.position + to);
    }

    addToken(type, value) {
        this.tokens.push({ type, value });
    }

    advance(n) {
        this.position += n;
    }

    choice(...actions) {
        for (const action of actions) {
            if (action.call(this)) {
                return;
            }
        }
    }

    tokenize() {
        while (this.position < this.content.length) {
            this.runOne();
        }

        this.addToken('EOF', '');
        return this.tokens;
    }

    runOne() {
        this.choice(
            this.runWhitespace,
            this.runFlags,
            this.runOptionFlags,
            this.runQuote,
            this.runOpenQuote,
            this.runEndQuote,
            this.runSeparator,
            this.runWord
        );
    }

    runFlags() {
        if (this.state === 0) {
            for (const word of this.flagWords) {
                if (this.startsWith(word)) {
                    this.addToken('FlagWord', this.slice(0, word.length));
                    this.advance(word.length);
                    return true;
                }
            }
        }

        return false;
    }

    runOptionFlags() {
        if (this.state === 0) {
            for (const word of this.optionFlagWords) {
                if (this.startsWith(word)) {
                    this.addToken('OptionFlagWord', this.slice(0, word.length));
                    this.advance(word.length);
                    return true;
                }
            }
        }

        return false;
    }

    runQuote() {
        if (this.separator == null && this.quoted && this.startsWith('"')) {
            if (this.state === 1) {
                this.state = 0;
            } else if (this.state === 0) {
                this.state = 1;
            }

            this.addToken('Quote', '"');
            this.advance(1);
            return true;
        }

        return false;
    }

    runOpenQuote() {
        if (this.separator == null && this.quoted && this.startsWith('"')) {
            if (this.state === 0) {
                this.state = 2;
            }

            this.addToken('OpenQuote', '"');
            this.advance(1);
            return true;
        }

        return false;
    }

    runEndQuote() {
        if (this.separator == null && this.quoted && this.startsWith('”')) {
            if (this.state === 2) {
                this.state = 0;
            }

            this.addToken('EndQuote', '”');
            this.advance(1);
            return true;
        }

        return false;
    }

    runSeparator() {
        if (this.separator != null && this.startsWith(this.separator)) {
            this.addToken('Separator', this.slice(0, this.separator.length));
            this.advance(this.separator.length);
            return true;
        }

        return false;
    }

    runWord() {
        const wordRegex = this.state === 0
            ? /^\S+/
            : this.state === 1
                ? /^[^\s"]+/
                : /^[^\s”]+/;

        const wordMatch = this.match(wordRegex);
        if (wordMatch) {
            if (this.separator) {
                if (wordMatch[0].toLowerCase() === this.separator.toLowerCase()) {
                    return false;
                }

                const index = wordMatch[0].indexOf(this.separator);
                if (index === -1) {
                    this.addToken('Word', wordMatch[0]);
                    this.advance(wordMatch[0].length);
                    return true;
                }

                const actual = wordMatch[0].slice(0, index);
                this.addToken('Word', actual);
                this.advance(actual.length);
                return true;
            }

            this.addToken('Word', wordMatch[0]);
            this.advance(wordMatch[0].length);
            return true;
        }

        return false;
    }

    runWhitespace() {
        const wsMatch = this.match(/^\s+/);
        if (wsMatch) {
            this.addToken('WS', wsMatch[0]);
            this.advance(wsMatch[0].length);
            return true;
        }

        return false;
    }
}

class Parser {
    constructor(tokens, { separated }) {
        this.tokens = tokens;
        this.separated = separated;
        this.position = 0;
        this.result = {
            raws: [],
            phrases: [],
            flags: [],
            optionFlags: []
        };
    }

    next() {
        this.position++;
    }

    lookaheadN(n, ...types) {
        return this.tokens[this.position + n] != null && types.includes(this.tokens[this.position + n].type);
    }

    lookahead(...types) {
        return this.lookaheadN(0, ...types);
    }

    match(...types) {
        if (this.lookahead(...types)) {
            this.next();
            return this.tokens[this.position - 1];
        }

        throw new Error(`Unexpected token ${this.tokens[this.position].value} of type ${this.tokens[this.position].type} (this should never happen)`);
    }

    parse() {
        // -1 for EOF.
        while (this.position < this.tokens.length - 1) {
            this.runArgument();
        }

        this.match('EOF');
        return this.result;
    }

    runArgument() {
        const leading = this.lookahead('WS') ? this.match('WS').value : '';
        if (this.lookahead('FlagWord', 'OptionFlagWord')) {
            const parsed = this.parseFlag();
            const trailing = this.lookahead('WS') ? this.match('WS').value : '';
            const separator = this.lookahead('Separator') ? this.match('Separator').value : '';
            parsed.raw = `${leading}${parsed.raw}${trailing}${separator}`;
            this.result.raws.push(parsed.raw);
            if (parsed.value == null) {
                this.result.flags.push(parsed.key);
            } else {
                this.result.optionFlags.push([parsed.key, parsed.value]);
            }

            return;
        }

        const parsed = this.parsePhrase();
        const trailing = this.lookahead('WS') ? this.match('WS').value : '';
        const separator = this.lookahead('Separator') ? this.match('Separator').value : '';
        parsed.raw = `${leading}${parsed.raw}${trailing}${separator}`;
        this.result.raws.push(parsed.raw);
        this.result.phrases.push(parsed.value);
    }

    parseFlag() {
        if (this.lookahead('FlagWord')) {
            const flag = this.match('FlagWord');
            const parsed = { key: flag.value, raw: flag.value };
            return parsed;
        }

        // Otherwise, `this.lookahead('OptionFlagWord')` should be true.
        const flag = this.match('OptionFlagWord');
        const parsed = { key: flag.value, value: '', raw: flag.value };
        const ws = this.lookahead('WS') ? this.match('WS') : null;
        if (ws != null) {
            parsed.raw += ws.value;
        }

        const phrase = this.lookahead('Quote', 'OpenQuote', 'EndQuote', 'Word')
            ? this.parsePhrase()
            : null;

        if (phrase != null) {
            parsed.value = phrase.value;
            parsed.raw += phrase.raw;
        }

        return parsed;
    }

    parsePhrase() {
        if (!this.separated) {
            if (this.lookahead('Quote')) {
                const parsed = { value: '', raw: '' };
                const openQuote = this.match('Quote');
                parsed.raw += openQuote.value;
                while (this.lookahead('Word', 'WS')) {
                    const match = this.match('Word', 'WS');
                    parsed.value += match.value;
                    parsed.raw += match.value;
                }

                const endQuote = this.lookahead('Quote') ? this.match('Quote') : null;
                if (endQuote != null) {
                    parsed.raw += endQuote.value;
                }

                return parsed;
            }

            if (this.lookahead('OpenQuote')) {
                const parsed = { value: '', raw: '' };
                const openQuote = this.match('OpenQuote');
                parsed.raw += openQuote.value;
                while (this.lookahead('Word', 'WS')) {
                    const match = this.match('Word', 'WS');
                    if (match.type === 'Word') {
                        parsed.value += match.value;
                        parsed.raw += match.value;
                    } else {
                        parsed.raw += match.value;
                    }
                }

                const endQuote = this.lookahead('EndQuote') ? this.match('EndQuote') : null;
                if (endQuote != null) {
                    parsed.raw += endQuote.value;
                }

                return parsed;
            }

            if (this.lookahead('EndQuote')) {
                const endQuote = this.match('EndQuote');
                const parsed = { value: endQuote.value, raw: endQuote.value };
                return parsed;
            }
        }

        if (this.separated) {
            const init = this.match('Word');
            const parsed = { value: init.value, raw: init.value };
            while (this.lookahead('WS') && this.lookaheadN(1, 'Word')) {
                const ws = this.match('WS');
                const word = this.match('Word');
                parsed.value += ws.value + word.value;
            }

            parsed.raw = parsed.value;
            return parsed;
        }

        const word = this.match('Word');
        const parsed = { value: word.value, raw: word.value };
        return parsed;
    }
}

class ContentParser {
    constructor({
        flagWords = [],
        optionFlagWords = [],
        quoted = true,
        separator
    } = {}) {
        this.flagWords = flagWords;
        this.flagWords.sort((a, b) => b.length - a.length);

        this.optionFlagWords = optionFlagWords;
        this.optionFlagWords.sort((a, b) => b.length - a.length);

        this.quoted = Boolean(quoted);
        this.separator = separator;
    }

    parse(content) {
        const tokens = new Tokenizer(content, {
            flagWords: this.flagWords,
            optionFlagWords: this.optionFlagWords,
            quoted: this.quoted,
            separator: this.separator
        }).tokenize();

        return new Parser(tokens, { separated: this.separator != null }).parse();
    }

    static getFlags(args) {
        const res = {
            flagWords: [],
            optionFlagWords: []
        };

        for (const arg of args) {
            const arr = res[arg.match === ArgumentMatches.FLAG ? 'flagWords' : 'optionFlagWords'];
            if (arg.match === ArgumentMatches.FLAG || arg.match === ArgumentMatches.OPTION) {
                if (Array.isArray(arg.flag)) {
                    arr.push(...arg.flag);
                } else {
                    arr.push(arg.flag);
                }
            }
        }

        return res;
    }
}

module.exports = ContentParser;
