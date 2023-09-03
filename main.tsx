import {
    App,
    Modal,
    Plugin,
    PluginSettingTab,
    Setting,
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
    sourcePath: string;
    link: {
        path: string;
        subpath: string;
    };
    position: number;
};

type OrphanBlockIdentifier = {
    sourceNote: JsNote;
    sourcePath: string;
    blockIdentifier: string;
    positionStart: number;
    positionEnd: number;
    needleContext: string;
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
        // TODO: remove?
        this.addRibbonIcon("dice", "Sample Plugin", (evt: MouseEvent) => {
            // Called when the user clicks the icon.
            // new Notice("This is a notice!");
            openAppModal(this.app);
        });

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
        this.addSettingTab(new AppSettingTab(this.app, this));
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

function FindOrphanBlockIdentifiers() {
    const [processingState, setProcessingState] = useState<ProcessingState>(
        ProcessingState.Initializing
    );
    const app = useApp();
    if (!app) {
        return null;
    }

    const { vault, metadataCache, workspace } = app;

    async function getBlockIdentifiers(jsNotes: JsNote[]) {
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
                    const startNeedleContext = Math.max(
                        positionStart - CONTEXT_SIZE,
                        0
                    );
                    const endNeedleContext = Math.min(
                        positionEnd + CONTEXT_SIZE,
                        note.content.length
                    );

                    let needleContext = note.content.slice(
                        startNeedleContext,
                        endNeedleContext
                    );

                    if (startNeedleContext !== 0) {
                        needleContext = `...${needleContext}`;
                    }

                    if (endNeedleContext < note.content.length) {
                        needleContext = `${needleContext}...`;
                    }

                    needleContext = needleContext.replace(/\n/g, " ");

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
                    const parseLinktextResult = parseLinktext(
                        `${pathToFile}#^${blockIdentifier}`
                    );
                    const maybeFile = metadataCache.getFirstLinkpathDest(
                        parseLinktextResult.path,
                        note.path
                    );
                    if (maybeFile) {
                        const fileCache = metadataCache.getFileCache(maybeFile);
                        if (fileCache) {
                            const subPathResult = resolveSubpath(
                                fileCache,
                                parseLinktextResult.subpath
                            );

                            if (!subPathResult) {
                                // TODO: this is a broken link

                                const brokenLink: BrokenLink = {
                                    sourcePath: note.path,
                                    link: {
                                        path: maybeFile.path,
                                        subpath: parseLinktextResult.subpath,
                                    },
                                    position: result.index ?? 0,
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
                            sourcePath: note.path,
                            link: {
                                path: parseLinktextResult.path,
                                subpath: parseLinktextResult.subpath,
                            },
                            position: result.index ?? 0,
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

        console.log("jsNotes", jsNotes);
        console.log("brokenLinks", brokenLinks);
        console.log("orphanBlockIdentifiers", orphanBlockIdentifiers);

        if (orphanBlockIdentifiers.length > 0) {
            const foo = orphanBlockIdentifiers[0];
            console.log("foo", foo);
            workspace
                .getLeaf()
                .openFile(foo.sourceNote.file)
                .then(() => {
                    if (
                        workspace.activeEditor &&
                        workspace.activeEditor.editor
                    ) {
                        const { editor } = workspace.activeEditor;
                        const editorPositionStart = editor.offsetToPos(
                            foo.positionStart
                        );
                        const editorPositionEnd = editor.offsetToPos(
                            foo.positionEnd
                        );
                        console.log("foo.position", foo.positionStart);
                        console.log("editorPosition", editorPositionStart);
                        editor.setCursor(editorPositionStart);

                        editor.setSelection(
                            editorPositionStart,
                            editorPositionEnd
                        );

                        console.log("getSelection", editor.getSelection());
                        // editor.replaceSelection("Sample Editor Command");
                    }
                });
        }

        return {
            jsNotes,
            brokenLinks,
            orphanBlockIdentifiers,
        };
    }

    function showError(error: Error) {
        console.error(error);
    }

    useEffect(() => {
        // console.log("unresolvedLinks", metadataCache.unresolvedLinks);
        getNotesFromVault(vault, metadataCache)
            .then(getBlockIdentifiers)
            // .then(findOrphanBlockIdentifiers)
            .catch(showError);
    }, [app]);

    if (processingState == ProcessingState.Initializing) {
        return <div>🏗️ Retrieving notes...</div>;
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
                <FindOrphanBlockIdentifiers />
            </AppContext.Provider>
        );
    }
}

class AppSettingTab extends PluginSettingTab {
    plugin: AppPlugin;

    constructor(app: App, plugin: AppPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Setting #1")
            .setDesc("It's a secret")
            .addText((text) =>
                text
                    .setPlaceholder("Enter your secret")
                    .setValue(this.plugin.settings.mySetting)
                    .onChange(async (value) => {
                        this.plugin.settings.mySetting = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
