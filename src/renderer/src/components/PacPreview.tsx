import { CloseIcon } from './Icons'

interface PacPreviewProps {
  pac: string
  onClose: () => void
}

export function PacPreview({ pac, onClose }: PacPreviewProps): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pac-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pac-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pac-modal-head">
          <div>
            <h2 id="pac-preview-title">生成的 PAC</h2>
            <p>只读预览</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭 PAC 预览">
            <CloseIcon />
          </button>
        </div>
        <pre>{pac}</pre>
      </section>
    </div>
  )
}
