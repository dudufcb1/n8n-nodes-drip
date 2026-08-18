import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import type { DelayRange, DelayUnit, DripPreset, WaitMode } from './delay';
import { randomDelayMs, resolveRange, resolveWaitMode } from './delay';

type ApplyMode = 'run' | 'item';

interface DripOptions {
	readonly outputDelay?: boolean;
}

export class Drip implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Drip',
		name: 'drip',
		icon: { light: 'file:drip.svg', dark: 'file:drip.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{ $parameter["preset"] }}',
		description: 'Hold items for a random amount of time before letting them through',
		defaults: {
			name: 'Drip',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Pace',
				name: 'preset',
				type: 'options',
				default: 'fast',
				description: 'How long to hold each run before passing the items on',
				options: [
					{ name: 'Fast (3-5 Seconds)', value: 'fast' },
					{ name: 'Medium (10-20 Seconds)', value: 'medium' },
					{ name: 'Slow (1-3 Minutes)', value: 'slow' },
					{ name: 'Custom', value: 'custom' },
				],
			},
			{
				displayName: 'Minimum',
				name: 'min',
				type: 'number',
				default: 3,
				required: true,
				typeOptions: { minValue: 0 },
				description: 'Shortest possible wait',
				displayOptions: { show: { preset: ['custom'] } },
			},
			{
				displayName: 'Maximum',
				name: 'max',
				type: 'number',
				default: 5,
				required: true,
				typeOptions: { minValue: 0 },
				description: 'Longest possible wait',
				displayOptions: { show: { preset: ['custom'] } },
			},
			{
				displayName: 'Unit',
				name: 'unit',
				type: 'options',
				default: 'seconds',
				description: 'Unit the minimum and maximum are expressed in',
				options: [
					{ name: 'Milliseconds', value: 'milliseconds' },
					{ name: 'Seconds', value: 'seconds' },
					{ name: 'Minutes', value: 'minutes' },
				],
				displayOptions: { show: { preset: ['custom'] } },
			},
			{
				displayName: 'Apply',
				name: 'applyTo',
				type: 'options',
				default: 'run',
				description:
					'Whether to wait once per node run or once before every item. Inside a loop the node runs on every iteration, so "Once per Run" already waits on each pass.',
				options: [
					{
						name: 'Once per Run',
						value: 'run',
						description: 'One wait each time the node runs, no matter how many items came in',
					},
					{
						name: 'Per Item',
						value: 'item',
						description: 'One wait before each item. Always waits in memory.',
					},
				],
			},
			{
				displayName: 'Wait Mode',
				name: 'waitMode',
				type: 'options',
				default: 'auto',
				description:
					'Whether to hold the execution in memory or park it in the database while it waits',
				options: [
					{
						name: 'Auto',
						value: 'auto',
						description: 'In memory under 65 seconds, persistent above that',
					},
					{
						name: 'In Memory',
						value: 'memory',
						description: 'Keeps the execution running. Simplest, but holds a slot.',
					},
					{
						name: 'Persistent',
						value: 'persistent',
						description:
							'Frees the worker while it waits. The scheduler wakes executions up every 60 seconds, so short waits get rounded up.',
					},
				],
				displayOptions: { show: { applyTo: ['run'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Output Delay',
						name: 'outputDelay',
						type: 'boolean',
						default: false,
						description: 'Whether to add a dripDelayMs field to every output item',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const applyTo = this.getNodeParameter('applyTo', 0) as ApplyMode;
		const options = this.getNodeParameter('options', 0, {}) as DripOptions;
		const reportDelay = options.outputDelay === true;

		if (applyTo === 'item') {
			return [await dripPerItem(this, items, reportDelay)];
		}

		return [await dripOncePerRun(this, items, reportDelay)];
	}
}

/**
 * Lee el rango configurado para un item concreto.
 * Va por itemIndex para que min, max y unit puedan venir de expresiones distintas en cada item.
 */
function readRange(context: IExecuteFunctions, itemIndex: number): DelayRange {
	const preset = context.getNodeParameter('preset', itemIndex) as DripPreset;
	const min = context.getNodeParameter('min', itemIndex, 0) as number;
	const max = context.getNodeParameter('max', itemIndex, 0) as number;
	const unit = context.getNodeParameter('unit', itemIndex, 'seconds') as DelayUnit;

	try {
		return resolveRange(preset, min, max, unit);
	} catch (error) {
		const reason = error instanceof RangeError ? error.message : 'Invalid delay range';
		throw new NodeOperationError(context.getNode(), reason, { itemIndex });
	}
}

/** Copia el item agregándole el retraso que se aplicó, para poder auditarlo en el historial de ejecuciones. */
function withDelayField(
	item: INodeExecutionData,
	delayMs: number,
	itemIndex: number,
): INodeExecutionData {
	return {
		json: { ...item.json, dripDelayMs: delayMs },
		binary: item.binary,
		pairedItem: { item: itemIndex },
	};
}


/**
 * Espera antes de cada item, siempre en memoria.
 * El modo persistente no cabe aquí: el motor guarda un solo waitTill por ejecución, así que
 * llamarlo dentro del bucle solo dejaría vivo el último y las esperas anteriores se perderían.
 */
async function dripPerItem(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
	reportDelay: boolean,
): Promise<INodeExecutionData[]> {
	const output: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		const delayMs = randomDelayMs(readRange(context, itemIndex));
		await sleep(delayMs);
		output.push(
			reportDelay
				? withDelayField(items[itemIndex], delayMs, itemIndex)
				: { ...items[itemIndex], pairedItem: { item: itemIndex } },
		);
	}

	return output;
}

/**
 * Una sola espera por corrida del nodo, sin importar cuántos items entraron.
 * Dentro de un bucle el nodo corre una vez por vuelta, así que en la práctica espera en cada pasada.
 */
async function dripOncePerRun(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
	reportDelay: boolean,
): Promise<INodeExecutionData[]> {
	const delayMs = randomDelayMs(readRange(context, 0));
	const waitMode = resolveWaitMode(context.getNodeParameter('waitMode', 0) as WaitMode, delayMs);

	if (waitMode === 'persistent') {
		// putExecutionToWait no bloquea: marca la ejecución y el motor la suspende cuando el nodo termina.
		await context.putExecutionToWait(new Date(Date.now() + delayMs));
	} else {
		await sleep(delayMs);
	}

	if (!reportDelay) {
		return items;
	}

	return items.map((item, itemIndex) => withDelayField(item, delayMs, itemIndex));
}
