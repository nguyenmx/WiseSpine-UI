import React, { useEffect, useState, useCallback, useRef } from 'react';
import { SidePanel, Header } from '@ohif/ui-next';
import { HangingProtocolService } from '@ohif/core';
import { Toolbar } from '@ohif/extension-default';
import { useAppConfig } from '@state';
import { useNavigate, useLocation } from 'react-router-dom';
import { preserveQueryParameters } from '@ohif/app';
import ChatController from '../components/chatbot/ChatController';
import { setViewportMeta } from '../components/chatbot/viewportContext';

const CHAT_TAB = {
  id: 'aiChat',
  name: 'aiChat',
  label: 'AI Chat',
  iconName: 'TabChatBubble',
  iconLabel: 'AI Chat',
  content: ChatController,
};

function ViewerHeader({ extensionManager, servicesManager, appConfig }) {
  const navigate = useNavigate();
  const location = useLocation();

  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);
    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    preserveQueryParameters(searchQuery);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  return (
    <Header
      menuOptions={[]}
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      Secondary={<Toolbar buttonSection="secondary" />}
    >
      <div className="relative flex justify-center gap-[4px]">
        <Toolbar buttonSection="primary" />
      </div>
    </Header>
  );
}

function WiseSpineLayoutComponent({
  extensionManager,
  servicesManager,
  commandsManager,
  hotkeysManager,
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
}) {
  const [appConfig] = useAppConfig();
  const { panelService, hangingProtocolService, viewportGridService, displaySetService } = servicesManager.services;

  const [showLoadingIndicator, setShowLoadingIndicator] = useState(
    appConfig.showLoadingIndicator
  );

  // Panel state
  const hasPanels = useCallback(
    side => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [hasRightPanels, setHasRightPanels] = useState(true);
  const [leftTabs, setLeftTabs] = useState(panelService.getPanels('left'));
  const [rightTabs, setRightTabs] = useState([...panelService.getPanels('right'), CHAT_TAB]);
  const [leftExpanded, setLeftExpanded] = useState(!leftPanelClosed);
  const [rightExpanded, setRightExpanded] = useState(!rightPanelClosed);
  const [leftActiveTabIndex, setLeftActiveTabIndex] = useState(0);
  const [rightActiveTabIndex, setRightActiveTabIndex] = useState(0);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const [leftPanelWidth, setLeftPanelWidth] = useState(282);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(280);
  const isResizingLeftRef = useRef(false);
  const resizeLeftStartXRef = useRef(0);
  const resizeLeftStartWidthRef = useRef(282);
  const dragLineRef = useRef<HTMLDivElement>(null);

  // Resize drag logic — right panel
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    if (dragLineRef.current) {
      dragLineRef.current.style.left = `${e.clientX}px`;
      dragLineRef.current.style.display = 'block';
    }
  }, [rightPanelWidth]);

  // Resize drag logic — left panel
  const handleLeftResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLeftRef.current = true;
    resizeLeftStartXRef.current = e.clientX;
    resizeLeftStartWidthRef.current = leftPanelWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    if (dragLineRef.current) {
      dragLineRef.current.style.left = `${e.clientX}px`;
      dragLineRef.current.style.display = 'block';
    }
  }, [leftPanelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // Move the drag indicator line — no setState, no React re-render, no canvas repaint
      if ((isResizingRef.current || isResizingLeftRef.current) && dragLineRef.current) {
        dragLineRef.current.style.left = `${e.clientX}px`;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (isResizingRef.current) {
        const delta = resizeStartXRef.current - e.clientX;
        const newWidth = Math.max(200, Math.min(700, resizeStartWidthRef.current + delta));
        setRightPanelWidth(newWidth);
      }
      if (isResizingLeftRef.current) {
        const delta = e.clientX - resizeLeftStartXRef.current;
        const newWidth = Math.max(200, Math.min(700, resizeLeftStartWidthRef.current + delta));
        setLeftPanelWidth(newWidth);
      }
      if (isResizingRef.current || isResizingLeftRef.current) {
        isResizingRef.current = false;
        isResizingLeftRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (dragLineRef.current) dragLineRef.current.style.display = 'none';
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Disable hotkeys when any chat tab is active, re-enable when viewport is clicked
  const isChatActive = rightExpanded && rightTabs[rightActiveTabIndex]?.id === 'aiChat';

  useEffect(() => {
    if (isChatActive) {
      hotkeysManager.disable();
    } else {
      hotkeysManager.enable();
    }
  }, [isChatActive, hotkeysManager]);

  // Listen for panel changes
  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(true);
        setLeftTabs(panelService.getPanels('left'));
        setRightTabs([...panelService.getPanels('right'), CHAT_TAB]);
        if (options?.leftPanelClosed !== undefined) {
          setLeftExpanded(!options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined) {
          setRightExpanded(!options.rightPanelClosed);
        }
      }
    );
    return () => unsubscribe();
  }, [panelService, hasPanels]);

  // Listen for panel activation
  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.ACTIVATE_PANEL,
      activatePanelEvent => {
        const leftIdx = leftTabs.findIndex(
          tab => tab.id === activatePanelEvent.panelId
        );
        if (leftIdx !== -1) {
          setLeftExpanded(true);
          setLeftActiveTabIndex(leftIdx);
          return;
        }
        const rightIdx = rightTabs.findIndex(
          tab => tab.id === activatePanelEvent.panelId
        );
        if (rightIdx !== -1) {
          setRightExpanded(true);
          setRightActiveTabIndex(rightIdx);
        }
      }
    );
    return () => unsubscribe();
  }, [panelService, leftTabs, rightTabs]);

  // Hide loading indicator when protocol changes
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      HangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      () => setShowLoadingIndicator(false)
    );
    return () => unsubscribe();
  }, [hangingProtocolService]);

  // Keep DICOM metadata bridge up to date when the active viewport changes
  useEffect(() => {
    if (!viewportGridService || !displaySetService) return;

    const syncMeta = () => {
      try {
        const { activeViewportId, viewports } = viewportGridService.getState();
        const activeViewport = viewports.get(activeViewportId);
        const uid = activeViewport?.displaySetInstanceUIDs?.[0];
        if (!uid) return;
        const ds = displaySetService.getDisplaySetByUID(uid);
        if (!ds) return;
        setViewportMeta({
          patientName: ds.PatientName ?? ds.patientName,
          patientAge: ds.PatientAge ?? ds.patientAge,
          patientSex: ds.PatientSex ?? ds.patientSex,
          modality: ds.Modality ?? ds.modality,
          bodyPartExamined: ds.BodyPartExamined ?? ds.bodyPartExamined,
          studyDescription: ds.StudyDescription ?? ds.studyDescription,
          seriesDescription: ds.SeriesDescription ?? ds.seriesDescription,
          studyDate: ds.StudyDate ?? ds.studyDate,
        });
      } catch { /* silently ignore if services aren't ready */ }
    };

    const { unsubscribe } = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      syncMeta
    );
    syncMeta(); // run once on mount
    return () => unsubscribe();
  }, [viewportGridService, displaySetService]);

  // Prevent body scrolling
  useEffect(() => {
    document.body.classList.add('bg-black', 'overflow-hidden');
    return () => {
      document.body.classList.remove('bg-black', 'overflow-hidden');
    };
  }, []);

  const getViewportComponentData = viewportComponent => {
    const entry = extensionManager.getModuleEntry(viewportComponent.namespace);
    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div>
      <ViewerHeader
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={appConfig}
      />
      <div
        className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-black"
        style={{ height: 'calc(100vh - 52px)' }}
      >
        {/* Drag indicator line — shown during panel resize to avoid canvas repaints */}
        <div
          ref={dragLineRef}
          className="pointer-events-none absolute inset-y-0 z-50 w-0.5 bg-blue-400 opacity-80"
          style={{ display: 'none', left: 0 }}
        />

        {/* LEFT SIDE PANEL */}
        {hasLeftPanels && (
          <SidePanel
            side="left"
            tabs={leftTabs}
            activeTabIndex={leftActiveTabIndex}
            isExpanded={leftExpanded}
            onOpen={() => setLeftExpanded(true)}
            onClose={() => setLeftExpanded(false)}
            onActiveTabIndexChange={({ activeTabIndex }) =>
              setLeftActiveTabIndex(activeTabIndex)
            }
            expandedWidth={leftPanelWidth}
            collapsedWidth={25}
          />
        )}

        {/* LEFT PANEL RESIZE HANDLE */}
        {hasLeftPanels && leftExpanded && (
          <div
            className="group relative z-10 flex w-4 items-center justify-center"
            style={{ cursor: 'ew-resize' }}
            onMouseDown={handleLeftResizeMouseDown}
          >
            <div className="h-8 w-0.5 rounded bg-gray-600 group-hover:bg-blue-400" />
          </div>
        )}

        {/* VIEWPORT GRID */}
        <div
          className="flex h-full flex-1 flex-col"
          onMouseDown={() => hotkeysManager.enable()}
        >
          <div className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-black">
            <ViewportGridComp
              servicesManager={servicesManager}
              viewportComponents={viewportComponents}
              commandsManager={commandsManager}
            />
          </div>
        </div>

        {/* RIGHT PANEL RESIZE HANDLE */}
        {hasRightPanels && rightExpanded && (
          <div
            className="group relative z-10 flex w-4 items-center justify-center"
            style={{ cursor: 'ew-resize' }}
            onMouseDown={handleResizeMouseDown}
          >
            <div className="h-8 w-0.5 rounded bg-gray-600 group-hover:bg-blue-400" />
          </div>
        )}

        {/* RIGHT SIDE PANEL */}
        {hasRightPanels && (
          <SidePanel
            side="right"
            tabs={rightTabs}
            activeTabIndex={rightActiveTabIndex}
            isExpanded={rightExpanded}
            onOpen={() => setRightExpanded(true)}
            onClose={() => setRightExpanded(false)}
            onActiveTabIndexChange={({ activeTabIndex }) =>
              setRightActiveTabIndex(activeTabIndex)
            }
            expandedWidth={rightPanelWidth}
            collapsedWidth={25}
          />
        )}
      </div>
    </div>
  );
}

export default WiseSpineLayoutComponent;
