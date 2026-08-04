import { createMioCopy, type MioCopy } from './copy';
import {
	applyCareAction,
	catchUpPet,
	getMood,
	restorePetState,
	type CareAction,
} from './pet';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const STORAGE_KEY = 'pet-state';
const REFRESH_MS = 5 * 60 * 1000;
let instanceCounter = 0;

export function mountMioWidget(
	container: HTMLElement,
	ctx: WidgetContext,
	copy: MioCopy = createMioCopy(),
): WidgetTeardown {
	let destroyed = false;
	let refreshId: ReturnType< typeof setInterval > | null = null;
	let reactionId: ReturnType< typeof setTimeout > | null = null;
	let state = restorePetState( ctx.storage.get( STORAGE_KEY ), Date.now() );
	const instanceId = `mio-companion-${ ++instanceCounter }`;

	const root = document.createElement( 'section' );
	root.className = 'mio-companion';
	root.setAttribute( 'aria-labelledby', `${ instanceId }-title` );
	root.innerHTML = buildMarkup();

	const eyebrow = required< HTMLElement >( root, '.mio-companion__eyebrow' );
	const title = required< HTMLElement >( root, '.mio-companion__title' );
	const moodLabel = required< HTMLElement >( root, '.mio-companion__mood' );
	const screen = required< HTMLElement >( root, '.mio-companion__screen' );
	const greetButton = required< HTMLButtonElement >(
		root,
		'[data-action="boop"]',
	);
	const status = required< HTMLElement >( root, '.mio-companion__status' );
	const actionGroup = required< HTMLElement >( root, '.mio-companion__actions' );
	const note = required< HTMLElement >( root, '.mio-companion__note' );
	const actionLabels: Record< CareAction, HTMLElement > = {
		starlight: required(
			root,
			'[data-action="starlight"] .mio-companion__control-label',
		),
		quiet: required(
			root,
			'[data-action="quiet"] .mio-companion__control-label',
		),
		explore: required(
			root,
			'[data-action="explore"] .mio-companion__control-label',
		),
	};

	title.id = `${ instanceId }-title`;
	eyebrow.textContent = copy.eyebrow;
	title.textContent = copy.title;
	screen.setAttribute( 'aria-label', copy.screenLabel );
	greetButton.setAttribute( 'aria-label', copy.greetLabel );
	actionGroup.setAttribute( 'aria-label', copy.careGroupLabel );
	actionLabels.starlight.textContent = copy.actions.starlight.label;
	actionLabels.quiet.textContent = copy.actions.quiet.label;
	actionLabels.explore.textContent = copy.actions.explore.label;
	note.textContent = copy.note;
	const baseUrl = ctx.pluginUrl.replace( /\/+$/, '' );
	const habitatUrl = `${ baseUrl }/assets/images/mio-lcd-habitat-pixel.webp`;
	root.style.setProperty(
		'--mio-habitat-image',
		`url(${ JSON.stringify( habitatUrl ) })`,
	);
	container.appendChild( root );

	const persist = (): void => {
		ctx.storage.set( STORAGE_KEY, state );
	};
	const setStatus = ( message: string ): void => {
		if ( status.textContent !== message ) {
			status.textContent = message;
		}
	};

	const render = ( announcement?: string ): void => {
		const mood = getMood( state );
		const presentation = copy.moods[ mood ];
		root.dataset.mood = mood;
		moodLabel.textContent = presentation.label;
		setStatus( announcement ?? presentation.status );
	};

	const react = ( reaction: CareAction | 'boop' ): void => {
		root.dataset.reacting = 'true';
		root.dataset.reaction = reaction;
		if ( reactionId !== null ) {
			clearTimeout( reactionId );
		}
		reactionId = setTimeout( () => {
			if ( destroyed ) {
				return;
			}
			delete root.dataset.reacting;
			delete root.dataset.reaction;
			reactionId = null;
		}, 520 );
	};

	const onClick = ( event: Event ): void => {
		const target = event.target;
		if ( ! ( target instanceof Element ) ) {
			return;
		}
		const button = target.closest< HTMLButtonElement >( 'button' );
		if ( ! button || ! root.contains( button ) ) {
			return;
		}

		if ( button.dataset.action === 'boop' ) {
			react( 'boop' );
			render( copy.greetReaction );
			return;
		}

		const action = button.dataset.action;
		if ( isCareAction( action ) ) {
			state = applyCareAction( state, action, Date.now() );
			persist();
			react( action );
			render( copy.actions[ action ].reaction );
		}
	};

	const refresh = (): void => {
		if ( destroyed ) {
			return;
		}
		state = catchUpPet( state, Date.now() );
		persist();
		render();
	};

	const startRefresh = (): void => {
		if ( refreshId === null && ! document.hidden ) {
			refreshId = setInterval( refresh, REFRESH_MS );
		}
	};

	const stopRefresh = (): void => {
		if ( refreshId !== null ) {
			clearInterval( refreshId );
			refreshId = null;
		}
	};

	const onVisibilityChange = (): void => {
		if ( document.hidden ) {
			stopRefresh();
			return;
		}
		refresh();
		startRefresh();
	};

	root.addEventListener( 'click', onClick );
	document.addEventListener( 'visibilitychange', onVisibilityChange );
	persist();
	render();
	startRefresh();

	return () => {
		if ( destroyed ) {
			return;
		}
		destroyed = true;
		persist();
		stopRefresh();
		if ( reactionId !== null ) {
			clearTimeout( reactionId );
			reactionId = null;
		}
		root.removeEventListener( 'click', onClick );
		document.removeEventListener( 'visibilitychange', onVisibilityChange );
		root.remove();
	};
}

function buildMarkup(): string {
	return `
		<header class="mio-companion__header">
			<div>
				<span class="mio-companion__eyebrow"></span>
				<h2 class="mio-companion__title"></h2>
			</div>
			<span class="mio-companion__mood"></span>
		</header>
		<div class="mio-companion__screen" role="group">
			<button class="mio-companion__mio" type="button" data-action="boop">
				<span class="mio-companion__star mio-companion__star--one" aria-hidden="true">✦</span>
				<span class="mio-companion__star mio-companion__star--two" aria-hidden="true">·</span>
				<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
					<path class="mio-companion__body" d="M9 3H23V5H27V8H29V26H25V29H21V27H17V29H13V27H9V29H5V8H7V5H9Z" />
					<path class="mio-companion__body-fill" d="M10 6H22V8H25V11H27V24H23V26H19V24H15V26H11V24H7V11H9V8H10Z" />
					<g class="mio-companion__eyes">
						<rect x="11" y="13" width="3" height="6" />
						<rect x="19" y="13" width="3" height="6" />
					</g>
				</svg>
			</button>
			<p class="mio-companion__status" role="status" aria-live="polite" aria-atomic="true"></p>
		</div>
		<div class="mio-companion__actions" role="group">
			<button class="mio-companion__control" type="button" data-action="starlight"><span class="mio-companion__control-cap" aria-hidden="true">✦</span><span class="mio-companion__control-label"></span></button>
			<button class="mio-companion__control" type="button" data-action="quiet"><span class="mio-companion__control-cap" aria-hidden="true">≈</span><span class="mio-companion__control-label"></span></button>
			<button class="mio-companion__control" type="button" data-action="explore"><span class="mio-companion__control-cap" aria-hidden="true">↗</span><span class="mio-companion__control-label"></span></button>
		</div>
		<p class="mio-companion__note"></p>
	`;
}

function required< T extends Element >( root: HTMLElement, selector: string ): T {
	const element = root.querySelector< T >( selector );
	if ( ! element ) {
		throw new Error( `Mio Companion markup is missing ${ selector }.` );
	}
	return element;
}

function isCareAction( value: string | undefined ): value is CareAction {
	return value === 'starlight' || value === 'quiet' || value === 'explore';
}
