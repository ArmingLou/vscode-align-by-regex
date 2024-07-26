import { Line } from './line';
import { Part, PartType } from './Part';
import { checkedRegex, tabAwareLength, trimEndButOne, trimButOne, trimStartButOne, extendToLength, trimEnd } from './string-utils';
import * as vscode from 'vscode';

export class Block {

    lines: Line[] = [];

    constructor(text: string, inputs: string[], startLine: number, eol: vscode.EndOfLine) {
        let splitString: string;
        if (eol === vscode.EndOfLine.CRLF) {
            splitString = '\r\n';
        } else {
            splitString = '\n';
        }
        let textLines = text.split(splitString);


        /* basic protection from bad regexes */
        for (let i = 0; i < textLines.length; i++) {
            let lineText = textLines[i];
            let lineObject = { number: startLine + i, parts: [] as Part[], reg: [] as Part[][] };
            let match = true;
            for (let input of inputs) {
                // 分段匹配，每个正则都必须有匹配结果，可以空串。任意一个正则不匹配，则本行都不处理。
                let regParts = [] as Part[];

                let zip = false;
                if (input.startsWith('$')) {
                    zip = true;
                    input = input.substring(1);//去掉开头的的特殊标记“$” 表示将匹配到的内容最后合并成一个
                }

                let loop = false;
                if (input.startsWith('+')) {
                    loop = true;
                    input = input.substring(1);//去掉开头的特殊标记“+” 表示贪婪模式循环匹配
                }

                let zipPer = false;
                if (!zip && loop) {
                    if (input.startsWith('$')) {
                        zipPer = true;
                        input = input.substring(1);//去掉开头的的特殊标记“$” 表示每次循环将匹配到的内容合并成一个
                    }
                }


                let regex = checkedRegex(input);
                if (regex === undefined) {
                    match = false;
                    break;
                }
                /* get all matches at once */
                // let textStartPosition = 0;
                let result;
                let lastIdx = 0;
                match = false;
                let first = true;
                result = regex.exec(lineText)
                while (result) {
                    let st0 = result[0];
                    if (st0 === undefined) {
                        match = false;
                        break;
                    }

                    if (st0 === '' && !first) {
                        break;
                    }

                    first = false;
                    match = true;

                    if (result.length < 2) {
                        // 无分组，直接匹配
                        // lineObject.parts.push({ type: PartType.Regex, value: st0 });
                        regParts.push({ type: PartType.Regex, value: st0 });
                    } else {
                        // 有分组，匹配每一个分组
                        let zipVal = '';
                        for (let j = 1; j < result.length; j++) {
                            let st = result[j];
                            if (st === undefined) {
                                st = '';
                            }
                            if (zipPer) {
                                zipVal += st;
                            } else {
                                regParts.push({ type: PartType.Regex, value: st });
                            }
                        }
                        if (zipPer) {
                            regParts.push({ type: PartType.Regex, value: zipVal });
                        }
                    }

                    if (st0 === '') {
                        // 死循环
                        break;
                    }

                    // 截断
                    lastIdx = regex.lastIndex;
                    lineText = lineText.substring(lastIdx)
                    if (loop) {
                        regex = checkedRegex(input);
                        if (regex === undefined) {
                            match = false;
                            break;
                        }
                        result = regex.exec(lineText)
                    } else {
                        break;
                    }
                }
                if (match === false) {
                    break;
                }

                if (zip) {
                    let v = '';
                    for (let k = 0; k < regParts.length; k++) {
                        v += regParts[k].value;
                    }
                    regParts = [{ type: PartType.Regex, value: v }];
                }

                lineObject.reg.push(regParts);
                // 截断
                // lineText = lineText.substring(lastIdx)
            }
            if (match) {
                this.lines.push(lineObject);
            } else {
                continue;
            }
        }


        // 对齐循环匹配的内容，补齐为最长一行匹配数量的内容
        let maxCount: Map<number, number> = new Map();
        for (let i = 0; i < this.lines.length; i++) {
            let line = this.lines[i];
            for (let j = 0; j < line.reg.length; j++) {
                let reg = line.reg[j];
                let count = maxCount.get(j) || 0;
                if (count < reg.length) {
                    maxCount.set(j, reg.length);
                }
            }
        }
        for (let i = 0; i < this.lines.length; i++) {
            let line = this.lines[i];
            for (let j = 0; j < line.reg.length; j++) {
                let reg = line.reg[j];
                let count = maxCount.get(j) || 0;
                let diff = count - reg.length;
                if (diff > 0) {
                    for (let k = 0; k < diff; k++) {
                        reg.push({ type: PartType.Regex, value: '' });
                    }
                }
                this.lines[i].parts.push(...reg);
            }
        }
    }

    trim(): Block {
        for (let line of this.lines) {
            for (let i = 0; i < line.parts.length; i++) {
                let part = line.parts[i];
                if (i === 0) {
                    part.value = trimEndButOne(part.value);
                } else if (i < line.parts.length - 1) {
                    part.value = trimButOne(part.value);
                } else {
                    let intermediate = trimStartButOne(part.value);
                    part.value = trimEnd(intermediate);
                }
            }
        }
        return this;
    }

    align(): Block {
        /* get editor tab size */
        let tabSize: number | undefined = vscode.workspace.getConfiguration('editor', null).get('tabSize');

        /* check that we actually got a valid tab size and that it isn't set to a value < 1. */
        if (tabSize === undefined || tabSize < 1) {
            /* give helpful error message on console */
            console.log('Error [Align by Regex]: Invalid tab size setting "editor.tabSize" for alignment.');

            /* assume tab size == 1 if tab size is missing */
            tabSize = 1;
        }

        /* get maximum number of parts */
        let maxNrParts: number = 1;
        for (let idx = 0; idx < this.lines.length; ++idx) {
            let len = this.lines[idx].parts.length;
            if (len > maxNrParts) {
                maxNrParts = len;
            }
        }

        /* create array with the right size and initialize array with 0 */
        let maxLength: number[] = Array(maxNrParts).fill(0);
        for (let line of this.lines) {
            // no match, only one part => ignore line in max length calculation
            if (line.parts.length > 1) {
                for (let i = 0; i < line.parts.length; i++) {
                    maxLength[i] = Math.max(maxLength[i], tabAwareLength(line.parts[i].value, tabSize));
                }
            }
        }
        for (let line of this.lines) {
            for (let i = 0; i < line.parts.length - 1; i++) {
                line.parts[i].value = extendToLength(line.parts[i].value, maxLength[i], tabSize);
            }
        }
        return this;
    }
}