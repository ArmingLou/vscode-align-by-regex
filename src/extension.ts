'use strict';
import { Block } from './block';
import * as vscode from 'vscode';
import { trimEnd } from './string-utils';

export interface Config {
    alignRegExp: string[];
    startRegExp: string | undefined;
    endRegExp: string | undefined;
}

let lastInput: string;

export function activate(context: vscode.ExtensionContext) {


    let alignByRegex = vscode.commands.registerTextEditorCommand('align.by.regex', cmdAlign);
    context.subscriptions.push(alignByRegex);

    // 对齐 sql ddl
    let alignByRegexSql = vscode.commands.registerTextEditorCommand('align.by.regex.sql', async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
        await cmdAlign(textEditor, edit, 'sql');
    });
    context.subscriptions.push(alignByRegexSql);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

async function cmdAlign(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) {
    let input = '';
    if (args !== undefined && args.length > 0) {
        input = args[0];
    }
    input = input.trim();
    if (input === '') {
        // 弹出输入框
        let input2 = await vscode.window.showInputBox({ prompt: 'Enter regular expression or template name.', value: lastInput });
        if (input2 !== undefined && input2.length > 0) {
            input = input2;
            lastInput = input;
        } else {
            // 取消
            return;
        }
    }
    let confg: Config | undefined = undefined;
    let templates = vscode.workspace.getConfiguration().get('align.by.regex.templates');
    if (templates !== undefined) {
        let conf = (<any>templates)[input];
        if (conf !== undefined) {
            confg = conf as Config;
        }
    }

    if (confg === undefined) {
        confg = { alignRegExp: [input] } as Config;
    }

    let blocks: Block[] = getBlocks(confg, textEditor, edit);
    if (blocks.length === 0) {
        return;
    }
    await textEditor.edit(e => {
        for (let block of blocks) {
            for (let line of block.lines) {
                let deleteRange = new vscode.Range(new vscode.Position(line.number, 0), new vscode.Position(line.number, textEditor.document.lineAt(line.number).range.end.character));
                let replacement: string = '';
                for (let part of line.parts) {
                    replacement += part.value;
                }
                replacement = trimEnd(replacement);
                e.replace(deleteRange, replacement);
            }
        }
    });
}

function getBlocks(conf: Config, textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit): Block[] {

    let alignRec = conf.alignRegExp;

    let selection: vscode.Selection = textEditor.selection;
    let blocks: Block[] = [];
    let textDocument = textEditor.document;
    if (!selection.isEmpty) {
        // 只对选择范围进行格式化
        let endLine = selection.end.line;
        let endPosition = selection.end;
        if (endPosition.character === 0) {
            endLine--;
        }

        let range = new vscode.Range(new vscode.Position(selection.start.line, 0), new vscode.Position(endLine, textDocument.lineAt(endLine).range.end.character));
        let text = textDocument.getText(range);
        let block: Block = new Block(text, alignRec, selection.start.line, textDocument.eol).align();
        blocks.push(block);
    } else if (conf.startRegExp !== undefined && conf.startRegExp !== '' && conf.endRegExp !== undefined && conf.endRegExp !== '') {
        // 整个文档格式化
        let startRec: RegExp = new RegExp(conf.startRegExp);
        let endRec: RegExp = new RegExp(conf.endRegExp);

        try {
            startRec = new RegExp(conf.startRegExp);
            endRec = new RegExp(conf.endRegExp);
        } catch (error) {
            vscode.window.showErrorMessage('Invalid startRec Or endRec configuration: ' + conf.startRegExp + ' ' + conf.endRegExp);
            return blocks;
        }

        let open = false;
        let endLine = selection.end.line;
        let startLine = selection.end.line;
        for (let l = 0; l < textDocument.lineCount; l++) {
            const currentLine = textDocument.lineAt(l).text;
            if (!open && startRec.exec(currentLine)) {
                // headCounts++;
                open = true;
                startLine = l;
            } else if (open && endRec.exec(currentLine)) {
                open = false;
                endLine = l;
                let range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, textDocument.lineAt(endLine).range.end.character));
                let text = textDocument.getText(range);
                let block: Block = new Block(text, alignRec, startLine, textDocument.eol).align();
                blocks.push(block);
            }
        }
    }
    return blocks;
}
