import React from 'react'
import { Globe, Folder, ChevronRight, Loader2 } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const FolderPickerModal = ({ wizard }) => {
  const {
    googleFolderModal, setGoogleFolderModal,
    drives, loadingDrives, currentDriveId,
    folders, folderPath, loadingFolders,
    isServiceAccountDestinationAuth,
    sharedFolders, loadingSharedFolders,
    sharedFolderQuery, setSharedFolderQuery,
    sharedFolderReference, setSharedFolderReference,
    resolvingSharedFolder,
    handleDriveChange, handleOpenSubFolder, handleBreadcrumbNav,
    handleSelectCurrentFolder, handleResolveSharedFolder,
    loadSharedFolders, applyGoogleFolderSelection, openFolderLocation,
    resolveDriveName,
  } = wizard

  return (
    googleFolderModal ? (
    <AppModalShell
      title="Select Google Drive folder"
      description="Choose the storage location used by this flow. Shared Drive folders are preferred when the flow runs with a service account."
      icon={<Globe className="h-5 w-5" />}
      onClose={() => setGoogleFolderModal(false)}
      maxWidthClass="max-w-2xl"
      footer={
        <>
          <button onClick={() => setGoogleFolderModal(false)} className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2">Cancel</button>
          <button onClick={handleSelectCurrentFolder} className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-label font-emphasis text-white transition-colors hover:bg-brand-hover">
            <Folder className="w-3.5 h-3.5" /> Select Current Location
          </button>
        </>
      }
    >
      {loadingDrives ? <SpinCenter text="Loading drives…" /> : (
        <div className="space-y-3">
          {drives.length > 1 && (
            <select value={currentDriveId} onChange={e => handleDriveChange(e.target.value)}
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none">
              {drives.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}

          {/* Breadcrumb */}
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-surface-2 px-3 py-2 text-caption">
            {folderPath.map((item, idx) => (
              <span key={item.id} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="w-3 h-3 text-text-quaternary" />}
                <span onClick={() => idx < folderPath.length - 1 && handleBreadcrumbNav(idx)}
                  className={idx === folderPath.length - 1 ? 'font-strong text-text-primary' : 'text-brand cursor-pointer hover:underline'}>
                  {item.name}
                </span>
              </span>
            ))}
          </div>

          {/* Service account shared folders */}
          {isServiceAccountDestinationAuth && (
            <div className="space-y-2">
              <div className="border-t border-[rgb(var(--border-line))] pt-2">
                <p className="mb-2 text-label font-emphasis text-text-tertiary">Shared to this service account</p>
                <Alert type="info" message="Need a directly shared folder?" description="Paste a folder link or search below. Only 'Shared Drive' folders can be used as backup destination." className="mb-2" />
                <div className="flex gap-2 mb-2">
                  <input value={sharedFolderReference} onChange={e => setSharedFolderReference(e.target.value)}
                    placeholder="Paste Google Drive folder link or ID"
                    className="flex-1 rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none" />
                  <button onClick={handleResolveSharedFolder} disabled={resolvingSharedFolder}
                    className="flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-label font-emphasis text-white hover:bg-brand-hover disabled:opacity-50">
                    {resolvingSharedFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Use folder
                  </button>
                </div>
                <div className="flex gap-2">
                  <input value={sharedFolderQuery} onChange={e => setSharedFolderQuery(e.target.value)}
                    placeholder="Search shared folders…"
                    className="flex-1 rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none" />
                  <button onClick={() => loadSharedFolders(sharedFolderQuery.trim())} disabled={loadingSharedFolders}
                    className="rounded-md border border-[rgb(var(--border-strong))] px-3 py-2 text-label font-emphasis hover:bg-surface-2 disabled:opacity-50">Search</button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto border border-[rgb(var(--border-line))] rounded-md">
                {loadingSharedFolders ? <SpinCenter text="Loading…" /> : sharedFolders.length === 0 ? <Empty description="No directly shared folders found" /> : sharedFolders.map(folder => (
                  <div key={folder.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-[rgb(var(--border-line))] last:border-0">
                    <Folder className="w-4 h-4 text-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-caption font-emphasis truncate">{folder.name}</div>
                      <div className="text-caption text-text-tertiary">Drive: {resolveDriveName(folder.drive_id, folder.drive_name || null)}</div>
                      <div className="flex gap-1 mt-1">
                        <Tag color="blue">Direct share</Tag>
                        {folder.drive_id ? <Tag color="green">Shared Drive</Tag> : <Tag color="gold">My Drive only</Tag>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openFolderLocation(folder)} className="rounded border border-[rgb(var(--border-strong))] px-2 py-1 text-label font-emphasis hover:bg-surface-2">Open</button>
                      {folder.drive_id
                        ? <button onClick={() => applyGoogleFolderSelection(folder)} className="rounded bg-brand px-2 py-1 text-label font-emphasis text-white hover:bg-brand-hover">Use</button>
                        : <button disabled title="Cannot use My Drive folder with service account" className="cursor-not-allowed rounded bg-brand/20 px-2 py-1 text-label font-emphasis text-white opacity-50">Use</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Folder list */}
          <div className={`overflow-y-auto border border-[rgb(var(--border-line))] rounded-md ${isServiceAccountDestinationAuth ? 'max-h-48' : 'max-h-72'}`}>
            {loadingFolders ? <SpinCenter text="Loading folders…" /> : folders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-quaternary">
                <Folder className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-caption">No sub-folders here</p>
              </div>
            ) : folders.map(folder => (
              <button key={folder.id} onClick={() => handleOpenSubFolder(folder)}
                className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-[rgb(var(--border-line))] last:border-0 hover:bg-surface-2 transition-colors text-left">
                <Folder className="w-4 h-4 text-warning shrink-0" />
                <span className="flex-1 text-caption">{folder.name}</span>
                <ChevronRight className="w-3.5 h-3.5 text-text-quaternary" />
              </button>
            ))}
          </div>
        </div>
      )}
    </AppModalShell>
    ) : null
  )
}

export default FolderPickerModal
