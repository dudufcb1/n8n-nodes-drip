/**
 * Lógica pura del cálculo de espera del nodo Drip.
 * Vive aparte del nodo para poder probarla sin levantar n8n.
 */

export type DelayUnit = 'milliseconds' | 'seconds' | 'minutes';

export type DripPreset = 'fast' | 'medium' | 'slow' | 'custom';

export type WaitMode = 'auto' | 'memory' | 'persistent';

export interface DelayRange {
	readonly minMs: number;
	readonly maxMs: number;
}

/** Umbral del motor de n8n: por debajo de esto conviene esperar en memoria, por encima persistir la ejecución. */
export const PERSISTENT_WAIT_THRESHOLD_MS = 65_000;

const UNIT_IN_MS: Record<DelayUnit, number> = {
	milliseconds: 1,
	seconds: 1_000,
	minutes: 60_000,
};

/** Rangos de los presets, en milisegundos. El usuario elige uno en vez de teclear números. */
export const PRESET_RANGES: Record<Exclude<DripPreset, 'custom'>, DelayRange> = {
	fast: { minMs: 3_000, maxMs: 5_000 },
	medium: { minMs: 10_000, maxMs: 20_000 },
	slow: { minMs: 60_000, maxMs: 180_000 },
};

export function toMilliseconds(value: number, unit: DelayUnit): number {
	return value * UNIT_IN_MS[unit];
}

/**
 * Traduce lo que el usuario configuró a un rango en milisegundos.
 * Con preset 'custom' usa los valores capturados; con cualquier otro ignora min/max y unit.
 * Lanza RangeError si el rango es imposible, para que el nodo lo reporte como error de configuración.
 */
export function resolveRange(
	preset: DripPreset,
	minValue: number,
	maxValue: number,
	unit: DelayUnit,
): DelayRange {
	if (preset !== 'custom') {
		return PRESET_RANGES[preset];
	}

	const minMs = toMilliseconds(minValue, unit);
	const maxMs = toMilliseconds(maxValue, unit);

	if (minMs < 0 || maxMs < 0) {
		throw new RangeError('Minimum and maximum must be zero or greater');
	}
	if (minMs > maxMs) {
		throw new RangeError('Minimum cannot be greater than maximum');
	}

	return { minMs, maxMs };
}

/**
 * Devuelve un entero de milisegundos dentro del rango, ambos extremos incluidos.
 * El generador se inyecta para poder fijarlo en las pruebas.
 */
export function randomDelayMs(range: DelayRange, random: () => number = Math.random): number {
	const min = Math.ceil(range.minMs);
	const max = Math.floor(range.maxMs);
	if (max <= min) {
		return min;
	}
	return min + Math.floor(random() * (max - min + 1));
}

/** Con 'auto' decide según el umbral del motor; con el resto respeta lo que eligió el usuario. */
export function resolveWaitMode(mode: WaitMode, delayMs: number): Exclude<WaitMode, 'auto'> {
	if (mode !== 'auto') {
		return mode;
	}
	return delayMs >= PERSISTENT_WAIT_THRESHOLD_MS ? 'persistent' : 'memory';
}
