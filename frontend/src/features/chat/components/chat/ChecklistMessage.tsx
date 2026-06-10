import { CheckCircle2 } from 'lucide-react';
import './ChecklistMessage.css';

const KEY_LABELS: Record<string, string> = {
  contact_name: 'Contact Name',
  role:         'Role',
  uni:          'UNI',
  department:   'Department',
  is_event:     'Event Related',
  service_type: 'Service',
  brief:        'Brief',
  details:      'Additional Details',
};

const SERVICE_LABELS: Record<string, string> = {
  web_services:    'Web Services/Digital Marketing',
  media_outreach:  'Media Outreach',
  photo:           'Photo Request',
  digital_screens: 'Digital Screens',
  web_article:     'Web Article',
  event_coverage:  'Event Coverage',
  youtube:         'YouTube/Video',
  social_media:    'Social Media',
  event_promotion: 'Event Promotion',
  consultation:    'MarComms Consultation',
};

interface ChecklistMessageProps {
  content: string;
  onConfirm: (msg: string) => void;
  onEdit: (msg: string) => void;
}

function parseChecklist(content: string): Array<{ key: string; value: string }> {
  const lines = content.split('\n').slice(1); // skip __checklist__ marker
  return lines
    .map(line => {
      const match = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
      if (!match) return null;
      const rawKey = match[1];
      const rawValue = match[2];
      const label = KEY_LABELS[rawKey] || rawKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const value = rawKey === 'service_type' ? (SERVICE_LABELS[rawValue] || rawValue) : rawValue;
      return { key: label, value };
    })
    .filter((item): item is { key: string; value: string } => item !== null);
}

export function ChecklistMessage({ content, onConfirm, onEdit }: ChecklistMessageProps) {
  const fields = parseChecklist(content);

  return (
    <div className="checklist-card">
      <div className="checklist-header">
        <CheckCircle2 size={16} className="checklist-icon" />
        <span className="checklist-title">Ready to submit</span>
      </div>

      <div className="checklist-fields">
        {fields.map(({ key, value }) => (
          <div key={key} className="checklist-field">
            <span className="checklist-field-key">{key}</span>
            <span className="checklist-field-value">{value}</span>
          </div>
        ))}
      </div>

      <div className="checklist-actions">
        <button
          className="checklist-btn-edit"
          onClick={() => onEdit("I'd like to make some changes")}
        >
          Edit
        </button>
        <button
          className="checklist-btn-submit"
          onClick={() => onConfirm("Yes, this looks good — please submit the request")}
        >
          Submit request
        </button>
      </div>
    </div>
  );
}
