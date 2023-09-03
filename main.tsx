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
import _ from "lodash";

type BrokenLink = {
    sourcePath: string;
    link: {
        path: string;
        subpath: string;
    };
};

type OrphanBlockIdentifier = {
    sourcePath: string;
    blockIdentifier: string;
};

function beforeLast(value: string, delimiter: string): string {
    value = value || "";

    if (delimiter === "") {
        return value;
    }

    const substrings = value.split(delimiter);

    return substrings.length === 1
        ? value // delimiter is not part of the string
        : substrings.slice(0, -1).join(delimiter);
}
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
    title: string;
    path: string;
    content: string;
    aliases: string[];

    constructor(
        title: string,
        path: string,
        content: string,
        aliases: string[] = []
    ) {
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
        const jsNote = new JsNote(name, path, content, aliases);
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

    const { vault, metadataCache } = app;

    async function getBlockIdentifiers(jsNotes: JsNote[]) {
        setProcessingState(ProcessingState.Scanning);

        // Get all block identifier references
        const expectedBlockIdentifierLinks = new Set<string>();

        jsNotes.map((note: JsNote) => {
            const re = new RegExp("\\^([a-zA-Z0-9-]+)$", "gm");

            for (const result of note.content.matchAll(re)) {
                if (result.length == 2) {
                    const blockIdentifier = result[1];

                    const blockSubpath = `${note.path}#^${blockIdentifier}`;
                    expectedBlockIdentifierLinks.add(blockSubpath);
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
                        };
                        brokenLinks.push(brokenLink);
                    }
                }
            }
        });

        const orphanBlockIdentifiers: Array<OrphanBlockIdentifier> = [];

        for (const orphanBlockIdentifierLink of expectedBlockIdentifierLinks) {
            const sourcePath = beforeLast(orphanBlockIdentifierLink, "#^");
            const result = orphanBlockIdentifierLink.split("#^");
            const blockIdentifier = result[result.length - 1];
            const orphanBlockIdentifier = {
                sourcePath,
                blockIdentifier,
            };
            orphanBlockIdentifiers.push(orphanBlockIdentifier);
        }

        console.log("jsNotes", jsNotes);
        console.log("brokenLinks", brokenLinks);
        console.log("orphanBlockIdentifiers", orphanBlockIdentifiers);

        return {
            jsNotes,
            brokenLinks,
            orphanBlockIdentifiers,
        };
    }

    async function findOrphanBlockIdentifiers({
        jsNotes,
        blockIdentifierReferences,
        blockIdentifierLinks,
    }: {
        jsNotes: Array<JsNote>;
        blockIdentifierReferences: Set<string>;
        blockIdentifierLinks: Set<string>;
    }) {
        // orphanReferences = blockIdentifierReferences - blockIdentifierLinks
        const orphanReferences = _.filter(
            [...blockIdentifierReferences.values()],
            (x: string) => {
                return !blockIdentifierLinks.has(x);
            }
        );

        // brokenLinks = blockIdentifierLinks - blockIdentifierReferences
        const brokenLinks = _.filter(
            [...blockIdentifierLinks.values()],
            (x: string) => {
                return !blockIdentifierReferences.has(x);
            }
        );

        // console.log("orphanReferences", orphanReferences);
        // console.log("brokenLinks", brokenLinks);

        return {
            orphanReferences,
            brokenLinks,
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
