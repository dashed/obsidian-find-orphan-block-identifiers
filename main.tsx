import {
    App,
    Modal,
    Plugin,
    Vault,
    TFile,
    MetadataCache,
    parseFrontMatterAliases,
    parseLinktext,
    resolveSubpath,
    CachedMetadata,
    CacheItem,
    PluginSettingTab,
    Setting,
} from "obsidian";
import { createRoot, Root } from "react-dom/client";
import * as React from "react";
import { useContext, useEffect, useState } from "react";

const CONTEXT_SIZE = 20;
type BrokenLink = {
    sourceNote: JsNote;
    sourcePath: string;
    link: {
        path: string;
        subpath: string;
    };
    positionStart: number;
    positionEnd: number;
    needleContext: {
        start: string;
        needle: string;
        end: string;
    };
};

type OrphanBlockIdentifier = {
    sourceNote: JsNote;
    sourcePath: string;
    blockIdentifier: string;
    positionStart: number;
    positionEnd: number;
    needleContext: {
        start: string;
        needle: string;
        end: string;
    };
};

interface PluginSettings {
    showRibbonIcon: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
    showRibbonIcon: true,
};

export default class AppPlugin extends Plugin {
    settings: PluginSettings;

    async onload() {
        await this.loadSettings();

        function openAppModal(app: App) {
            new AppModal(app).open();
        }

        if (this.settings.showRibbonIcon) {
            this.addRibbonIcon(
                "magnifying-glass",
                "Find Orphan Block Identifiers",
                (evt: MouseEvent) => {
                    openAppModal(this.app);
                }
            );
        }

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.setText("Status Bar Text");

        this.addCommand({
            id: "open-find-find-orphan-block-identifiers-modal",
            name: "Scan Vault",
            callback: () => {
                openAppModal(this.app);
            },
        });

        this.addSettingTab(new AppPluginSettingTab(this.app, this));
    }

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

const AppContext = React.createContext<App | undefined>(undefined);
const useApp = (): App | undefined => {
    return useContext(AppContext);
};

class IgnoreRangeBuilder {
    private readonly _ignoreRanges: IgnoreRange[] = [];
    private readonly _cache: CachedMetadata;
    private _content: string;
    private _name: string;

    constructor(content: string, cache: CachedMetadata, name: string) {
        this._content = content;
        this._cache = cache;
        this._name = name;
    }

    // adds an ignore range from the cache for an array of cache items
    private addCacheItem(cacheItem: CacheItem[]) {
        (cacheItem ? cacheItem : []).forEach((item) => {
            const ignoreRange = new IgnoreRange(
                item.position.start.offset,
                item.position.end.offset
            );
            this._ignoreRanges.push(ignoreRange);
            this._content =
                this._content.substring(0, ignoreRange.start) +
                " ".repeat(ignoreRange.end - ignoreRange.start) +
                this._content.substring(ignoreRange.end);
        });
        return this;
    }

    // adds all headings to the ignore ranges
    // headings are of the form # Heading
    public addHeadings(): IgnoreRangeBuilder {
        if (this._cache.headings) {
            return this.addCacheItem(this._cache.headings);
        }
        return this;
    }

    // Adds an ignore range from the cache for a specific section type
    private addCacheSections(type: string): IgnoreRangeBuilder {
        (this._cache.sections ? this._cache.sections : [])
            .filter((section) => section.type === type)
            .forEach((section) => {
                const ignoreRange = new IgnoreRange(
                    section.position.start.offset,
                    section.position.end.offset
                );
                this._ignoreRanges.push(ignoreRange);

                this._content =
                    this._content.substring(0, ignoreRange.start) +
                    " ".repeat(ignoreRange.end - ignoreRange.start) +
                    this._content.substring(ignoreRange.end);
            });
        return this;
    }

    // adds code blocks to the ignore ranges
    // code blocks are of the form ```code```
    public addCodeSections(): IgnoreRangeBuilder {
        return this.addCacheSections("code");
    }

    // utility function to add ignore ranges from a regex
    private addIgnoreRangesWithRegex(regex: RegExp): IgnoreRangeBuilder {
        this._content = this._content.replace(regex, (match, ...args) => {
            const start = args[args.length - 2];
            const end = start + match.length;
            this._ignoreRanges.push(new IgnoreRange(start, end));
            return " ".repeat(match.length);
        });
        return this;
    }

    public addMdMetadata(): IgnoreRangeBuilder {
        const regex = /---(.|\n)*---/g;
        return this.addIgnoreRangesWithRegex(regex);
    }

    // adds all html like text sections to the ignore ranges
    public addHtml(): IgnoreRangeBuilder {
        const regex = /<[^>]+>([^>]+<[^>]+>)?/g;
        return this.addIgnoreRangesWithRegex(regex);
    }

    public addInlineCode(): IgnoreRangeBuilder {
        const regex = /`.+`/g;
        return this.addIgnoreRangesWithRegex(regex);
    }

    // adds all web links to the ignore ranges
    public addWebLinks(): IgnoreRangeBuilder {
        // web links are of the form https://www.example.com or http://www.example.com or www.example.com
        const regex = /https?:\/\/www\..+|www\..+/g;
        return this.addIgnoreRangesWithRegex(regex);
    }

    public build(): IgnoreRange[] {
        return this._ignoreRanges.sort((a, b) => a.start - b.start);
    }
}

class IgnoreRange {
    start: number;
    end: number;
    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }

    static getIgnoreRangesFromCache(
        content: string,
        cache: CachedMetadata,
        name: string
    ): IgnoreRange[] {
        const ignoreRanges: IgnoreRange[] = new IgnoreRangeBuilder(
            content,
            cache,
            name
        )
            // from cache
            .addHeadings()
            .addCodeSections()
            // from regex
            .addMdMetadata()
            .addInlineCode()
            .addHtml()
            .addWebLinks()
            .build();

        return ignoreRanges;
    }
}

function whitespaceRange(s, start, end) {
    const substitute = " ".repeat(end - start);
    const head = s.substring(0, start);
    const rest = s.substring(end);
    return `${head}${substitute}${rest}`;
}

function sanitizeContent(content: string, ignoreRanges: IgnoreRange[]): string {
    for (const ignoreRange of ignoreRanges) {
        content = whitespaceRange(content, ignoreRange.start, ignoreRange.end);
    }
    return content;
}

class JsNote {
    file: TFile;
    title: string;
    path: string;
    originalContent: string;
    content: string;
    aliases: string[];
    ignore: IgnoreRange[];

    constructor(
        file: TFile,
        title: string,
        path: string,
        content: string,
        aliases: string[] = [],
        ignore: IgnoreRange[] = []
    ) {
        this.file = file;
        this.title = title;
        this.path = path;
        this.originalContent = content;
        this.content = sanitizeContent(content, ignore);
        this.aliases = aliases;
        this.ignore = ignore;
    }

    static async fromFile(
        file: TFile,
        vault: Vault,
        cache: MetadataCache
    ): Promise<JsNote> {
        const name = file.basename;
        const path = file.path;
        const content = await vault.cachedRead(file);
        const fileCache = cache.getFileCache(file);
        const aliases = fileCache
            ? parseFrontMatterAliases(fileCache.frontmatter) ?? []
            : [];
        const ignoreRanges = fileCache
            ? IgnoreRange.getIgnoreRangesFromCache(
                  content,
                  fileCache,
                  file.name
              )
            : [];
        const jsNote = new JsNote(
            file,
            name,
            path,
            content,
            aliases,
            ignoreRanges
        );
        return jsNote;
    }
}

enum ProcessingState {
    Initializing,
    Scanning,
    Finished,
    Error,
}

function generateNeedleContext(
    content: string,
    positionStart: number,
    positionEnd: number
) {
    let needleContext = content.slice(positionStart, positionEnd);

    const startNeedleContextPosition = Math.max(
        positionStart - CONTEXT_SIZE,
        0
    );
    let startNeedleContext = content.slice(
        startNeedleContextPosition,
        positionStart
    );
    if (startNeedleContextPosition !== 0) {
        startNeedleContext = `...${startNeedleContext}`;
    }

    const endNeedleContextPosition = Math.min(
        positionEnd + CONTEXT_SIZE,
        content.length
    );
    let endNeedleContext = content.slice(positionEnd, endNeedleContextPosition);

    if (endNeedleContextPosition < content.length) {
        endNeedleContext = `${endNeedleContext}...`;
    }

    startNeedleContext = startNeedleContext.replace(/\n/g, " ");
    needleContext = needleContext.replace(/\n/g, " ");
    endNeedleContext = endNeedleContext.replace(/\n/g, " ");

    return {
        start: startNeedleContext,
        needle: needleContext,
        end: endNeedleContext,
    };
}

async function getNotesFromVault(
    vault: Vault,
    cache: MetadataCache
): Promise<JsNote[]> {
    const notes = vault.getMarkdownFiles().map(async (file, index) => {
        return await JsNote.fromFile(file, vault, cache);
    });
    return await Promise.all(notes);
}

function BrokenLinksResult({
    result,
    onClick,
}: {
    result: BrokenLink[];
    onClick: (x: OrphanBlockIdentifier | BrokenLink) => void;
}) {
    if (result.length <= 0) {
        return null;
    }

    return (
        <div>
            <div style={{ marginBottom: "8px" }}>
                <strong>Broken Links</strong>
            </div>
            <div>
                <ol>
                    {result.map((brokenLink, index) => {
                        return (
                            <li
                                className="fobi-note-matching-result-item"
                                key={`broken-link-${index}-${brokenLink.sourcePath}`}
                            >
                                <a
                                    href="#"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        onClick(brokenLink);
                                    }}
                                >
                                    <code>
                                        <small>
                                            {brokenLink.needleContext.start}
                                        </small>
                                        <i>
                                            <small>
                                                <strong>
                                                    {
                                                        brokenLink.needleContext
                                                            .needle
                                                    }
                                                </strong>
                                            </small>
                                        </i>
                                        <small>
                                            {brokenLink.needleContext.end}
                                        </small>
                                    </code>
                                </a>
                            </li>
                        );
                    })}
                </ol>
            </div>
        </div>
    );
}

function OrphanBlockIdentifiersResult({
    result,
    onClick,
}: {
    result: OrphanBlockIdentifier[];
    onClick: (x: OrphanBlockIdentifier | BrokenLink) => void;
}) {
    if (result.length <= 0) {
        return null;
    }

    return (
        <div>
            <div style={{ marginBottom: "8px" }}>
                <strong>Orphan Block Identifiers</strong>
            </div>
            <div>
                <ol>
                    {result.map((orphanBlockIdentifier, index) => {
                        return (
                            <li
                                className="fobi-note-matching-result-item"
                                key={`orphan-block-${index}-${orphanBlockIdentifier.sourcePath}`}
                            >
                                <a
                                    href="#"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        onClick(orphanBlockIdentifier);
                                    }}
                                >
                                    <code>
                                        <small>
                                            {
                                                orphanBlockIdentifier
                                                    .needleContext.start
                                            }
                                        </small>
                                        <i>
                                            <small>
                                                <strong>
                                                    {
                                                        orphanBlockIdentifier
                                                            .needleContext
                                                            .needle
                                                    }
                                                </strong>
                                            </small>
                                        </i>
                                        <small>
                                            {
                                                orphanBlockIdentifier
                                                    .needleContext.end
                                            }
                                        </small>
                                    </code>
                                </a>
                            </li>
                        );
                    })}
                </ol>
            </div>
        </div>
    );
}

type FileToResultsType = Map<
    string,
    {
        orphanBlockIdentifiers: Array<OrphanBlockIdentifier>;
        brokenLinks: Array<BrokenLink>;
        sourceNote: JsNote;
    }
>;

function FindOrphanBlockIdentifiers({
    closeModal,
}: {
    closeModal: () => void;
}) {
    const [processingState, setProcessingState] = useState<ProcessingState>(
        ProcessingState.Initializing
    );

    const [fileToResults, setFileToResults] = useState<FileToResultsType>(
        new Map()
    );

    const app = useApp();
    if (!app) {
        return null;
    }

    const { vault, metadataCache, workspace } = app;

    async function processNotes(jsNotes: JsNote[]) {
        setProcessingState(ProcessingState.Scanning);

        // Get all block identifier references
        const expectedBlockIdentifierLinks = new Set<string>();
        const expectedBlockIdentifierLinksMap = new Map<
            string,
            OrphanBlockIdentifier
        >();

        jsNotes.map((note: JsNote) => {
            const re = new RegExp("\\^([a-zA-Z0-9-]+)$", "gm");

            for (const result of note.content.matchAll(re)) {
                if (result.length == 2) {
                    const blockIdentifier = result[1];

                    const blockSubpath = `${note.path}#^${blockIdentifier}`;
                    expectedBlockIdentifierLinks.add(blockSubpath);

                    const positionStart = result.index ?? 0;
                    const positionEnd = positionStart + result[0].length;
                    const needleContext = generateNeedleContext(
                        note.originalContent,
                        positionStart,
                        positionEnd
                    );

                    const orphanBlockIdentifier: OrphanBlockIdentifier = {
                        sourceNote: note,
                        sourcePath: note.path,
                        blockIdentifier,
                        positionStart,
                        positionEnd,
                        needleContext,
                    };
                    expectedBlockIdentifierLinksMap.set(
                        blockSubpath,
                        orphanBlockIdentifier
                    );
                }
            }
        });

        // Get all links to block identifier references

        const brokenLinks: Array<BrokenLink> = [];

        jsNotes.map((note: JsNote) => {
            // const re = new RegExp("#\\^([a-zA-Z0-9-]+)[\\]|)]", "gm");
            const re = new RegExp(
                "[\\[(]([^\\[(]+)#\\^([a-zA-Z0-9-]+)[\\]|)]",
                "gm"
            );

            for (const result of note.content.matchAll(re)) {
                if (result.length == 3) {
                    const pathToFile = result[1];
                    const blockIdentifier = result[2];
                    const actualLinkPath = `${pathToFile}#^${blockIdentifier}`;
                    const parseLinktextResult = parseLinktext(actualLinkPath);
                    const maybeFile = metadataCache.getFirstLinkpathDest(
                        parseLinktextResult.path,
                        note.path
                    );

                    const positionStart = (result.index ?? 0) + 1;
                    const positionEnd = positionStart + actualLinkPath.length;
                    const needleContext = generateNeedleContext(
                        note.originalContent,
                        positionStart,
                        positionEnd
                    );

                    if (maybeFile) {
                        const fileCache = metadataCache.getFileCache(maybeFile);
                        if (fileCache) {
                            const subPathResult = resolveSubpath(
                                fileCache,
                                parseLinktextResult.subpath
                            );

                            if (!subPathResult) {
                                const brokenLink: BrokenLink = {
                                    sourceNote: note,
                                    sourcePath: note.path,
                                    link: {
                                        path: maybeFile.path,
                                        subpath: parseLinktextResult.subpath,
                                    },
                                    positionStart,
                                    positionEnd,
                                    needleContext,
                                };
                                brokenLinks.push(brokenLink);
                            } else {
                                // subpath was successfully resolved; remove it from expectedBlockIdentifierLinks.
                                // We prune expectedBlockIdentifierLinks down to list of set of broken links.
                                const fullBlockPath = `${maybeFile.path}#^${blockIdentifier}`;
                                if (
                                    expectedBlockIdentifierLinks.has(
                                        fullBlockPath
                                    )
                                ) {
                                    expectedBlockIdentifierLinks.delete(
                                        fullBlockPath
                                    );
                                }
                            }
                        }
                    } else {
                        const brokenLink: BrokenLink = {
                            sourceNote: note,
                            sourcePath: note.path,
                            link: {
                                path: parseLinktextResult.path,
                                subpath: parseLinktextResult.subpath,
                            },
                            positionStart,
                            positionEnd,
                            needleContext,
                        };
                        brokenLinks.push(brokenLink);
                    }
                }
            }
        });

        const orphanBlockIdentifiers: Array<OrphanBlockIdentifier> = [];

        for (const orphanBlockIdentifierLink of expectedBlockIdentifierLinks) {
            const orphanBlockIdentifier = expectedBlockIdentifierLinksMap.get(
                orphanBlockIdentifierLink
            );
            if (orphanBlockIdentifier) {
                orphanBlockIdentifiers.push(orphanBlockIdentifier);
            }
        }

        brokenLinks.forEach((brokenLink) => {
            const filePath = brokenLink.sourceNote.path;
            const result = fileToResults.get(filePath);
            if (!result) {
                fileToResults.set(filePath, {
                    orphanBlockIdentifiers: [],
                    brokenLinks: [brokenLink],
                    sourceNote: brokenLink.sourceNote,
                });
            } else {
                result.brokenLinks.push(brokenLink);
            }
        });

        orphanBlockIdentifiers.forEach((orphanBlockIdentifier) => {
            const filePath = orphanBlockIdentifier.sourceNote.path;
            const result = fileToResults.get(filePath);
            if (!result) {
                fileToResults.set(filePath, {
                    orphanBlockIdentifiers: [orphanBlockIdentifier],
                    brokenLinks: [],
                    sourceNote: orphanBlockIdentifier.sourceNote,
                });
            } else {
                result.orphanBlockIdentifiers.push(orphanBlockIdentifier);
            }
        });

        setFileToResults(fileToResults);
        setProcessingState(ProcessingState.Finished);
    }

    function showError(error: Error) {
        setProcessingState(ProcessingState.Error);
        console.error(error);
    }

    useEffect(() => {
        getNotesFromVault(vault, metadataCache)
            .then(processNotes)
            .catch(showError);
    }, [app]);

    function goToContext(result: OrphanBlockIdentifier | BrokenLink) {
        closeModal();

        const leaf = workspace.getLeaf();
        leaf.openFile(result.sourceNote.file).then(async () => {
            if (workspace.activeEditor && workspace.activeEditor.editor) {
                const { editor } = workspace.activeEditor;
                const editorPositionStart = editor.offsetToPos(
                    result.positionStart
                );
                const editorPositionEnd = editor.offsetToPos(
                    result.positionEnd
                );

                // Go to editing view in source mode.
                // This makes it easier to select link in their source code form.
                // Source: https://github.com/bwydoogh/obsidian-force-view-mode-of-note
                const viewState = leaf.getViewState();
                await leaf.setViewState({
                    ...viewState,
                    state: {
                        ...viewState.state,
                        mode: "source",
                        source: true,
                    },
                });

                editor.focus();
                // editor.setCursor(editorPositionStart);
                editor.setSelection(editorPositionStart, editorPositionEnd);

                // Revert to the original view state, but stay in editing view.
                await leaf.setViewState({
                    ...viewState,
                    state: {
                        ...viewState.state,
                        mode: "source",
                    },
                });
            }
        });
    }

    if (processingState == ProcessingState.Initializing) {
        return (
            <React.Fragment>
                <hr />
                <center>
                    <div>🏗️ Retrieving notes...</div>
                </center>
            </React.Fragment>
        );
    } else if (processingState == ProcessingState.Scanning) {
        return (
            <React.Fragment>
                <hr />
                <center>
                    <div>🔭 Scanning notes...</div>
                </center>
            </React.Fragment>
        );
    } else if (processingState == ProcessingState.Finished) {
        if (fileToResults.size <= 0) {
            return (
                <React.Fragment>
                    <hr />
                    <center>
                        <div>
                            🎉 No orphaned block identifiers nor broken links!
                        </div>
                    </center>
                </React.Fragment>
            );
        }
        return (
            <div>
                {[...fileToResults.keys()].map((filePath) => {
                    const result = fileToResults.get(filePath);
                    if (!result) {
                        return null;
                    }
                    return (
                        <div className="fobi-note-results" key={filePath}>
                            <div className="fobi-note-matching-result-title">
                                <center>
                                    <strong>{result?.sourceNote.title}</strong>
                                </center>
                                <center>
                                    <small>
                                        <i>{filePath}</i>
                                    </small>
                                </center>
                            </div>
                            <OrphanBlockIdentifiersResult
                                result={result.orphanBlockIdentifiers}
                                onClick={(
                                    result: OrphanBlockIdentifier | BrokenLink
                                ) => {
                                    goToContext(result);
                                }}
                            />
                            {result.orphanBlockIdentifiers.length &&
                            result.brokenLinks.length ? (
                                <br />
                            ) : null}
                            <BrokenLinksResult
                                result={result.brokenLinks}
                                onClick={(
                                    result: OrphanBlockIdentifier | BrokenLink
                                ) => {
                                    goToContext(result);
                                }}
                            />
                        </div>
                    );
                })}
            </div>
        );
    }

    return <div>💀 An error occurred while scanning Obsidian notes.</div>;
}

class AppModal extends Modal {
    private root: Root;

    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl, app } = this;
        this.root = createRoot(contentEl);

        this.root.render(
            <AppContext.Provider value={app}>
                <div id="fobi-plugin-container">
                    <center>
                        <strong>Find Orphan Block Identifiers</strong>
                    </center>
                    <center>
                        <small>
                            Obsidian plugin to find orphaned block references
                            and broken links.
                        </small>
                    </center>
                    <FindOrphanBlockIdentifiers
                        closeModal={() => {
                            this.close();
                        }}
                    />
                </div>
            </AppContext.Provider>
        );
    }
}

class AppPluginSettingTab extends PluginSettingTab {
    plugin: AppPlugin;

    constructor(app: App, plugin: AppPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        new Setting(containerEl)
            .setName("Show icon in sidebar")
            .setDesc(
                "If enabled, a button to scan the vault for orphan block identifiers or broken links will be added to the ribbon sidebar. " +
                    "It can also be invoked with a Hotkey. Changes only take effect on reload."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showRibbonIcon)
                    .onChange((value) => {
                        this.plugin.settings.showRibbonIcon = value;
                        this.plugin.saveData(this.plugin.settings);
                        this.display();
                    })
            );
    }
}
