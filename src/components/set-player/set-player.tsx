import {
  Component,
  h,
  Host,
  Element,
  State,
  Method,
  Prop,
  Listen,
  Fragment,
} from "@stencil/core";

import {
  MedHandler,
  ViewFocusDetail,
  ProgressCallback,
  Workspace,
  SlicesAction,
  ItemHandler,
  SerializableWorkspace,
  PanelLayout,
  ViewState,
  AsyncResult,
  MedSource,
} from "@sethealth/core";
import { createAlertModal } from "./alert";
import { reactiveMedia } from "../../utils";
import * as sethealth from "@sethealth/core";

interface PanelView {
  id: string;
  title: string;
  layout: PanelLayout;
  components: {
    type: string;
    state: ViewState;
  }[];
}

const isMobile = reactiveMedia("(max-width: 600px)");

const MENU = [
  {
    type: "browser",
    icon: "document-outline",
    selectedIcon: "document",
  },
];

@Component({
  tag: "set-player",
  styleUrl: "set-player.css",
  shadow: true,
})
export class SetPlayer {
  @Element() el!: HTMLSetPlayerElement;

  @State() showSelection = false;
  @State() selectedHandlers: MedHandler[] = [];
  @State() handlers: MedHandler[] = [];
  @State() views: PanelView[] = [];
  @State() selectedView?: PanelView;
  @State() showToolbar = false;
  @State() selectedController?: any;

  @State() loadingText?: string;
  @State() loadingProcess = 0;

  @Prop({ mutable: true }) sideMenu: string | undefined = undefined;
  @Prop({ mutable: true }) slicesAction: SlicesAction = "contrast";

  @Method()
  async openFromSource(source: MedSource) {
    this.loadingText = "Loading medical images";
    this.loadingProcess = 0;
    const handler = await sethealth.med.loadFromSource(
      source,
      (p) => (this.loadingProcess = p)
    );
    if (!handler.error) {
      await this.openMed(handler.value[0]);
    }
    this.loadingText = undefined;
  }

  @Method()
  async openFromID(id: string) {
    this.loadingText = "Loading medical images";
    this.loadingProcess = 0;
    const res = await loadPanelsFromId(id, (p) => (this.loadingProcess = p));
    if (res.value) {
      this.views.push(...res.value);
      this.selectedView = this.views[this.views.length - res.value.length];
    }
    this.loadingText = undefined;
  }

  @Listen("resize", { target: "window" })
  onWindowResize() {
    document.body.style.width = `${window.innerWidth}px`;
    document.body.style.height = `${window.innerHeight}px`;
  }

  @Listen("setMedChange", { target: "window" })
  async medChanged() {
    this.handlers = await sethealth.med.getAll();
  }

  async open(id: string) {
    const handler = await sethealth.med.get(id);
    if (handler) {
      await this.openMed(handler);
    }
  }

  async loadToken() {
    try {
      const token = await (
        await fetch("https://hub.sethealth.app/api/token")
      ).json();
      await sethealth.auth.setAccessToken(token.token);
    } catch (e) {
      console.error(e);
    }
    const hash = location.hash.substr(1);
    if (hash !== "") {
      const params = new URLSearchParams(hash);
      const panelId = params.get("id");
      if (panelId) {
        this.sideMenu = undefined;
        await this.openFromID(panelId);
        this.sideMenu = "browser";
      }
    }
  }

  async componentWillLoad() {
    this.loadToken();
    await sethealth.ready();

    const mainView: PanelView = {
      id: "welcome",
      title: "Welcome",
      layout: "single",
      components: [
        {
          type: "set-demo",
          state: {},
        },
      ],
    };
    const views = (this.views = [mainView]);
    this.selectedView = views[0];
  }

  private openFolder = async () => {
    const files = await sethealth.utils.openFiles(true, true);
    if (files.length > 0) {
      this.loadingText = "Loading files";
      this.loadingProcess = 0;
      await sethealth.med.loadFromFiles(
        files,
        (p) => (this.loadingProcess = p)
      );
      this.loadingText = undefined;
    }
  };

  private openFiles = async () => {
    const files = await sethealth.utils.openFiles(false, true);
    if (files.length > 0) {
      this.loadingText = "Loading files";
      this.loadingProcess = 0;
      await sethealth.med.loadFromFiles(
        files,
        (p) => (this.loadingProcess = p)
      );
      this.loadingText = undefined;
    }
  };

  private enterFullscreen = () => {
    if (document.fullscreenEnabled) {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } else {
        document.exitFullscreen();
      }
    }
  };

  private setWindowCloseWarning() {
    window.onbeforeunload = () => {
      return "Changes are not saved. Aree you sure you want to close the tab?";
    };
  }

  private onOpenVolume = (ev: CustomEvent<ItemHandler>) => {
    if (ev.detail.type === "med") {
      this.openMed(ev.detail);
      if (isMobile.matches) {
        this.sideMenu = undefined;
      }
    }
  };

  private onSelectionChanged = (ev: CustomEvent<ItemHandler[]>) => {
    const handlers = ev.detail.filter((i) => i.type === "med") as MedHandler[];
    this.selectedHandlers = handlers;
    const shareButton = this.el.shadowRoot!.querySelector(".share-button");
    if (shareButton && this.selectedHandlers.length > 1) {
      shareButton.classList.add("share-jump");
      setTimeout(() => {
        shareButton.classList.remove("share-jump");
      }, 300);
    }
  };

  private openMed = async (handler: MedHandler) => {
    const workspaces = handler.getWorkspaces().map((w) => w.id);
    let selectedView = this.views.find((v) => workspaces.includes(v.id));
    if (!selectedView) {
      selectedView = await createView(handler);
      this.views = [...this.views, selectedView];
    }
    this.selectedView = selectedView;
    this.setWindowCloseWarning();
  };

  private async getState(onProgress: ProgressCallback): Promise<Version3> {
    const views = await Promise.all(
      this.selectedHandlers.map(async (handler) => {
        const workspaces = handler.getWorkspaces().map((w) => w.id);
        let selectedView = this.views.find((v) => workspaces.includes(v.id));
        if (!selectedView) {
          selectedView = await createView(handler);
        }
        return selectedView;
      })
    );
    const workspaces = views.flatMap((view) =>
      view.components.map((c) => c.state.workspace!)
    );

    const serializableWorkspaces = await sethealth.workspace.ensureSources(
      workspaces,
      {
        anonymize: {
          keepStructuredReport: true,
          keepDescriptions: true,
        },
      },
      onProgress
    );
    if (serializableWorkspaces.error) {
      throw serializableWorkspaces.value;
    }

    return {
      version: 3,
      workspaces: serializableWorkspaces.value,
      views,
    };
  }

  private sharePanel = async () => {
    if (!this.showSelection) {
      this.showSelection = true;
    }
    if (this.selectedHandlers.length === 0) {
      return;
    }
    await createAlertModal(async (onProgress) => {
      const progress = await sethealth.utils.createProgress(onProgress);
      const finalUpload = progress.source(1);
      const panelState = await this.getState(progress.source(10));
      return sharePanel(panelState, finalUpload);
    });
  };

  private viewFocusChanged = (ev: CustomEvent<ViewFocusDetail>) => {
    this.selectedController = ev.detail.controller;
  };

  private toggleSide = () => {
    this.showToolbar = !this.showToolbar;
  };

  componentDidRender() {
    if (!this.selectedController) {
      const pane = this.el.shadowRoot?.querySelector("set-pane");
      if (pane) {
        pane.markFocus();
      }
    }
  }

  private renderHeader() {
    return (
      <header>
        <div class="header-top">
          <a
            href="https://set.health?openviewhealth"
            class="logo"
            title="Sethealth"
            target="_blank"
            rel="noopener"
          >
            <picture>
              <source
                srcSet="/assets/logo-small-dark.svg"
                media="(prefers-color-scheme: dark)"
              />
              <img src="/assets/logo-small.svg" alt="Sethealth logo" />
            </picture>
          </a>
        </div>

        <div class="header-buttons">
          {MENU.map((item) => {
            const selected = this.sideMenu === item.type;
            return (
              <button
                class={{ selected: selected }}
                onClick={() => {
                  this.sideMenu = selected ? undefined : item.type;
                }}
              >
                <set-icon
                  name={
                    selected
                      ? item.selectedIcon ?? item.icon
                      : (item.icon as any)
                  }
                />
              </button>
            );
          })}
        </div>
        <div class="header-bottom-buttons">
          <button onClick={this.enterFullscreen} class="fullscreen-button">
            <set-icon name="expand"></set-icon>
          </button>
        </div>
      </header>
    );
  }

  private renderLeftMenu() {
    const showShareButton = this.handlers.length > 0;

    if (this.sideMenu === "browser") {
      return (
        <div class="side-menu" key="side-menu">
          <set-file-loader button={false} class="file-loader-browser">
            <div class="section-header">
              <h2>Browser</h2>
              <button class="section-header-button" onClick={this.openFolder}>
                <set-icon name="folder-open-outline" />
              </button>
              <button class="section-header-button" onClick={this.openFiles}>
                <set-icon name="document-outline" />
              </button>
            </div>
            <set-browser
              selectionType={this.showSelection ? "multiple" : undefined}
              items={this.handlers}
              onSetChange={this.onSelectionChanged}
              onSetClick={this.onOpenVolume}
            >
              <div slot="empty" class="empty-buttons">
                <button class="empty-button" onClick={this.openFolder}>
                  <set-icon name="folder-open-outline" />
                  Open folder
                </button>
                <button class="empty-button" onClick={this.openFiles}>
                  <set-icon name="document-outline" />
                  Open files
                </button>
              </div>
            </set-browser>
          </set-file-loader>
          <button
            disabled={!showShareButton}
            class={{
              "share-button": true,
              "share-visible": showShareButton,
            }}
            onClick={this.sharePanel}
          >
            <set-icon name="share"></set-icon>
            {this.selectedHandlers.length === 0
              ? "Select to share"
              : `Share ${this.selectedHandlers.length} docs`}
          </button>
        </div>
      );
    }
  }

  private renderEditor(hasToolbar: boolean) {
    const { selectedView } = this;
    const layout =
      selectedView?.layout === "4-views" && isMobile.matches
        ? "3-dynamic"
        : selectedView?.layout;

    return (
      <main
        class={{
          "has-toolbar": hasToolbar,
        }}
      >
        {this.loadingText && (
          <set-progress-bar value={this.loadingProcess} class="main-loading">
            {this.loadingText}
          </set-progress-bar>
        )}
        {hasToolbar && (
          <div class="main-toolbar">
            <set-control-toolbar
              selected={this.slicesAction}
              onSetChange={(ev: any) => (this.slicesAction = ev.detail)}
              tools={[
                "contrast",
                "crop",
                "cross-hair",
                "new-line",
                "new-spline",
                "new-point",
              ]}
            />
            <button onClick={this.toggleSide} class="side-menu-button">
              {this.showToolbar ? (
                <>
                  <set-icon name="close" />
                  <span>Close</span>
                </>
              ) : (
                <>
                  <set-icon name="arrow-back" />
                  <span>Menu</span>
                </>
              )}
            </button>
          </div>
        )}
        <div class="editor">
          {selectedView && (
            <set-grid-panel layout={layout} key={selectedView.id}>
              {selectedView.components.map((c) => {
                const Cmp = c.type;
                const attributes =
                  Cmp === "set-view-slices"
                    ? { ...c.state, pointerAction: this.slicesAction }
                    : c.state;
                return (
                  <set-pane showMaximize={true} state={c.state}>
                    <Cmp {...attributes} />
                  </set-pane>
                );
              })}
            </set-grid-panel>
          )}
          {hasToolbar && this.showToolbar && (
            <>
              <div class="side-menu-backdrop" onClick={this.toggleSide}></div>
              <set-sidemenu controller={this.selectedController} />
            </>
          )}
        </div>
      </main>
    );
  }

  render() {
    const { selectedView } = this;
    const hasToolbar = !!(selectedView && selectedView.title !== "Welcome");
    return (
      <Host onSetFocus={this.viewFocusChanged}>
        {this.renderHeader()}
        {this.renderLeftMenu()}
        {this.renderEditor(hasToolbar)}
      </Host>
    );
  }
}

const sharePanel = async (state: any, onProgress: ProgressCallback) => {
  const resSecret = await sethealth.storage.uploadMetadata(state, onProgress);
  if (resSecret.error) {
    throw resSecret.error;
  }

  const params = new URLSearchParams({
    id: resSecret.value.source,
  });
  const fragment = `#${params.toString()}`;
  history.replaceState(null, null as any, fragment);
  return `${location.origin}/${fragment}`;
};

const loadPanelsFromId = async (
  panelId: string,
  onProgress: ProgressCallback
) => {
  const progress = await sethealth.utils.createProgress(onProgress);
  const getPanelProgress = progress.source();
  const getImagesProgress = progress.source(10);

  const res = await sethealth.storage.loadMetadata(panelId, getPanelProgress);
  if (res.error) {
    progress.end();
    return res;
  }

  const panels = await loadPanelVersion3(res.value, getImagesProgress);
  progress.end();
  return panels;
};

interface Version3 {
  version: 3;
  workspaces: SerializableWorkspace[];
  views: {
    id: string;
    title: string;
    layout: PanelLayout;
    components: {
      type: string;
      state: ViewState;
    }[];
  }[];
}

const loadPanelVersion3 = async (
  state: Version3,
  onProgress: ProgressCallback
): AsyncResult<PanelView[]> => {
  const res = await sethealth.workspace.loadFromSerialization(
    state.workspaces,
    onProgress
  );
  if (res.error) {
    return res;
  }
  const value = state.views.map((view) => {
    const v: PanelView = {
      id: view.id,
      components: view.components,
      layout: view.layout,
      title: view.title,
    };
    return v;
  });
  return {
    value,
  };
};

const isWorkspace3D = (workspace?: Workspace) => {
  const z = workspace?.med?.volume?.dimensions.z ?? 0;
  return z > 5;
};

const createView = async (handler: MedHandler): Promise<PanelView> => {
  const workspace = await sethealth.workspace.create(handler);
  const isTouch = matchMedia("(any-hover: none)").matches;

  if (!workspace.med?.volume) {
    return {
      id: workspace.id,
      title: handler.description!,
      layout: "single",
      components: [
        {
          type: "set-view-report",
          state: {
            workspace,
          },
        },
      ],
    };
  } else if (!isWorkspace3D(workspace)) {
    return {
      id: workspace.id,
      title: handler.description!,
      layout: "single",
      components: [
        {
          type: "set-view-slices",
          state: {
            workspace,
            projection: "axial",
            showRange: isTouch,
          },
        },
      ],
    };
  } else {
    return {
      id: workspace.id,
      title: handler.description!,
      layout: "4-views",
      components: [
        {
          type: "set-view-slices",
          state: {
            workspace,
            projection: "axial",
            showRange: isTouch,
          },
        },
        {
          type: "set-view-volumetric",
          state: {
            workspace,
            showGeometry: true,
            showAxes: true,
          },
        },
        {
          type: "set-view-slices",
          state: {
            workspace,
            projection: "coronal",
            showRange: isTouch,
          },
        },
        {
          type: "set-view-slices",
          state: {
            workspace,
            projection: "sagittal",
            showRange: isTouch,
          },
        },
      ],
    };
  }
};
