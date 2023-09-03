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

interface MyPluginSettings {
    mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    mySetting: "default",
};

export default class AppPlugin extends Plugin {
    settings: MyPluginSettings;

    async onload() {
        await this.loadSettings();

        function openAppModal(app: App) {
            new AppModal(app).open();
        }

        // This creates an icon in the left ribbon.
        this.addRibbonIcon(
            "dice",
            "Find Orphan Block Identifiers",
            (evt: MouseEvent) => {
                openAppModal(this.app);
            }
        );

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.setText("Status Bar Text");

        this.addCommand({
            id: "open-find-find-orphan-block-identifiers-modal",
            name: "Open",
            callback: () => {
                openAppModal(this.app);
            },
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        // this.addSettingTab(new AppSettingTab(this.app, this));
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

class JsNote {
    file: TFile;
    title: string;
    path: string;
    content: string;
    aliases: string[];

    constructor(
        file: TFile,
        title: string,
        path: string,
        content: string,
        aliases: string[] = []
    ) {
        this.file = file;
        this.title = title;
        this.path = path;
        this.content = content;
        this.aliases = aliases;
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
        const jsNote = new JsNote(file, name, path, content, aliases);
        // console.log("name", name);
        return jsNote;
    }
}

enum ProcessingState {
    Initializing,
    Scanning,
    Finished,
    Error,
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

function FindOrphanBlockIdentifiers({
    closeModal,
}: {
    closeModal: () => void;
}) {
    const [processingState, setProcessingState] = useState<ProcessingState>(
        ProcessingState.Initializing
    );

    const app = useApp();
    if (!app) {
        return null;
    }

    const { vault, metadataCache, workspace } = app;

    const fileToResults = new Map<
        string,
        {
            orphanBlockIdentifiers: Array<OrphanBlockIdentifier>;
            brokenLinks: Array<BrokenLink>;
            sourceNote: JsNote;
        }
    >();

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
                    let needleContext = note.content.slice(
                        positionStart,
                        positionEnd
                    );

                    const startNeedleContextPosition = Math.max(
                        positionStart - CONTEXT_SIZE,
                        0
                    );
                    let startNeedleContext = note.content.slice(
                        startNeedleContextPosition,
                        positionStart
                    );
                    if (startNeedleContextPosition !== 0) {
                        startNeedleContext = `...${startNeedleContext}`;
                    }

                    const endNeedleContextPosition = Math.min(
                        positionEnd + CONTEXT_SIZE,
                        note.content.length
                    );
                    let endNeedleContext = note.content.slice(
                        positionEnd,
                        endNeedleContextPosition
                    );

                    if (endNeedleContextPosition < note.content.length) {
                        endNeedleContext = `${endNeedleContext}...`;
                    }

                    startNeedleContext = startNeedleContext.replace(/\n/g, " ");
                    needleContext = needleContext.replace(/\n/g, " ");
                    endNeedleContext = endNeedleContext.replace(/\n/g, " ");

                    const orphanBlockIdentifier: OrphanBlockIdentifier = {
                        sourceNote: note,
                        sourcePath: note.path,
                        blockIdentifier,
                        positionStart,
                        positionEnd,
                        needleContext: {
                            start: startNeedleContext,
                            needle: needleContext,
                            end: endNeedleContext,
                        },
                    };
                    expectedBlockIdentifierLinksMap.set(
                        blockSubpath,
                        orphanBlockIdentifier
                    );
                }
            }
        });

        // Get all links to block identifier references

        const removedExpectedBlockIdentifierLinks = new Set<string>();
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
                    let needleContext = note.content.slice(
                        positionStart,
                        positionEnd
                    );

                    const startNeedleContextPosition = Math.max(
                        positionStart - CONTEXT_SIZE,
                        0
                    );
                    let startNeedleContext = note.content.slice(
                        startNeedleContextPosition,
                        positionStart
                    );
                    if (startNeedleContextPosition !== 0) {
                        startNeedleContext = `...${startNeedleContext}`;
                    }

                    const endNeedleContextPosition = Math.min(
                        positionEnd + CONTEXT_SIZE,
                        note.content.length
                    );
                    let endNeedleContext = note.content.slice(
                        positionEnd,
                        endNeedleContextPosition
                    );

                    if (endNeedleContextPosition < note.content.length) {
                        endNeedleContext = `${endNeedleContext}...`;
                    }

                    startNeedleContext = startNeedleContext.replace(/\n/g, " ");
                    needleContext = needleContext.replace(/\n/g, " ");
                    endNeedleContext = endNeedleContext.replace(/\n/g, " ");

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
                                    needleContext: {
                                        start: startNeedleContext,
                                        needle: needleContext,
                                        end: endNeedleContext,
                                    },
                                };
                                brokenLinks.push(brokenLink);
                            } else {
                                const fullBlockPath = `${maybeFile.path}#^${blockIdentifier}`;
                                if (
                                    expectedBlockIdentifierLinks.has(
                                        fullBlockPath
                                    )
                                ) {
                                    expectedBlockIdentifierLinks.delete(
                                        fullBlockPath
                                    );
                                    removedExpectedBlockIdentifierLinks.add(
                                        fullBlockPath
                                    );
                                } else if (
                                    !removedExpectedBlockIdentifierLinks.has(
                                        fullBlockPath
                                    )
                                ) {
                                    // TODO: this is unexpected
                                    console.log("fullBlockPath", fullBlockPath);
                                    console.log(
                                        "fullBlockPath in expectedBlockIdentifierLinks?",
                                        expectedBlockIdentifierLinks.has(
                                            fullBlockPath
                                        )
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
                            needleContext: {
                                start: startNeedleContext,
                                needle: needleContext,
                                end: endNeedleContext,
                            },
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

        // console.log("jsNotes", jsNotes);
        // console.log("brokenLinks", brokenLinks);
        // console.log("orphanBlockIdentifiers", orphanBlockIdentifiers);

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

        setProcessingState(ProcessingState.Finished);
    }

    function showError(error: Error) {
        setProcessingState(ProcessingState.Error);
        console.error(error);
    }

    useEffect(() => {
        // console.log("unresolvedLinks", metadataCache.unresolvedLinks);
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
        return <div>🏗️ Retrieving notes...</div>;
    } else if (processingState == ProcessingState.Scanning) {
        return <div>🔭 Scanning notes...</div>;
    } else if (processingState == ProcessingState.Finished) {
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
                <div>
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
