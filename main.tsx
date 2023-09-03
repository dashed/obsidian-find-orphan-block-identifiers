import {
    App,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    Vault,
    TFile,
    MetadataCache,
    parseFrontMatterAliases,
} from "obsidian";
import { createRoot, Root } from "react-dom/client";
import * as React from "react";
import { useContext, useEffect } from "react";

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

        // This creates an icon in the left ribbon.
        // TODO: remove?
        const _ribbonIconEl = this.addRibbonIcon(
            "dice",
            "Sample Plugin",
            (evt: MouseEvent) => {
                // Called when the user clicks the icon.
                new Notice("This is a notice!");
            }
        );

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.setText("Status Bar Text");

        this.addCommand({
            id: "open-find-find-orphan-block-identifiers-modal",
            name: "Open",
            callback: () => {
                new AppModal(this.app).open();
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
    const app = useApp();
    if (!app) {
        return null;
    }

    const { vault, metadataCache } = app;

    function showError(error: Error) {
        console.error(error);
    }

    useEffect(() => {
        getNotesFromVault(vault, metadataCache).catch(showError);
        // JsNote.getNotesFromVault(vault, metadataCache)
        // 	.then(getLinkFinderResults)
        // 	.then(showMatchSelection)
        // 	.catch(showError);
    }, [app]);

    return <h4>Hello, Albert!</h4>;
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
