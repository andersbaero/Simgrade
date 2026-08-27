import { QUALITY_CLASS, SOCKET_CSS, STAT_NAMES, wowheadUrl } from './labels';
import { slotsOf } from './ItemSearch';
import type { CandidateItem } from './types';

interface Props {
	items: CandidateItem[];
	onRemove: (itemId: number) => void;
}

export default function ItemTable({ items, onRemove }: Props) {
	return (
		<div className="scroll" style={{ marginTop: 12 }}>
			<table>
				<thead>
					<tr>
						<th>Item</th>
						<th>Slot</th>
						<th>ilvl</th>
						<th>Phase</th>
						<th>Sockets</th>
						<th>Stats</th>
						<th>Source</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{items.map(item => (
						<tr key={item.id}>
							<td>
								<a href={wowheadUrl(item.id)} target="_blank" rel="noreferrer" className={QUALITY_CLASS[item.quality]}>
									{item.name}
								</a>
								{item.setName && <div className="tag set">{item.setName}</div>}
							</td>
							<td className="muted small">{slotsOf(item)}</td>
							<td className="muted">{item.ilvl}</td>
							<td className="muted">{item.phase}</td>
							<td>
								{item.sockets.map((color, index) => (
									<span key={index} className="socket" style={{ background: SOCKET_CSS[color] ?? '#555' }} />
								))}
								{item.socketBonus && <div className="small muted">{item.socketBonus}</div>}
							</td>
							<td className="small muted">
								{item.stats
									.slice(0, 5)
									.map(stat => `${stat.value} ${STAT_NAMES[stat.stat] ?? ''}`)
									.join(', ')}
							</td>
							<td className="small muted">
								{item.source}
								{item.zone && <div>{item.zone}</div>}
							</td>
							<td>
								<button className="remove" title="Remove" onClick={() => onRemove(item.id)}>
									×
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
