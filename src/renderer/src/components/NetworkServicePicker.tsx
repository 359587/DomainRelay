import type { NetworkService } from '../../../shared/types'

interface NetworkServicePickerProps {
  services: NetworkService[]
  selected: string[]
  disabled: boolean
  onChange: (selected: string[]) => void
}

export function NetworkServicePicker({
  services,
  selected,
  disabled,
  onChange
}: NetworkServicePickerProps): React.JSX.Element {
  const toggle = (service: NetworkService, checked: boolean): void => {
    if (checked) {
      onChange([...selected, service.name])
      return
    }
    onChange(selected.filter((name) => name !== service.name))
  }

  return (
    <div className="network-picker" role="group" aria-label="系统网络入口">
      {services.map((service) => {
        const checked = selected.includes(service.name)
        const keepLastSelection = checked && selected.length === 1
        const itemDisabled = disabled || service.disabled || keepLastSelection
        return (
          <label className={`network-option ${checked ? 'network-option-selected' : ''}`} key={service.name}>
            <input
              type="checkbox"
              checked={checked}
              disabled={itemDisabled}
              onChange={(event) => toggle(service, event.target.checked)}
            />
            <span className="network-checkbox" aria-hidden="true" />
            <span className="network-option-copy">
              <span className="network-option-name">
                <strong>{service.name}</strong>
                {service.isDefault ? <em>当前使用</em> : null}
              </span>
              <small>
                {service.device ? `${service.device} · ` : ''}
                {service.disabled ? '系统已停用' : checked ? '将应用 PAC' : '沿用系统设置'}
              </small>
            </span>
          </label>
        )
      })}
    </div>
  )
}
