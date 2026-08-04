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
	root.innerHTML = buildMarkup( instanceId );

	const title = required< HTMLElement >( root, '.mio-companion__title' );
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
	container.classList.add( 'mio-companion-host' );
	const card = container.closest< HTMLElement >(
		'.os-widgets__card, .desktop-mode-widgets__card',
	);
	card?.classList.add(
		'os-widgets__card--mio-companion',
		'desktop-mode-widgets__card--mio-companion',
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
		container.classList.remove( 'mio-companion-host' );
		card?.classList.remove(
			'os-widgets__card--mio-companion',
			'desktop-mode-widgets__card--mio-companion',
		);
	};
}

function buildMarkup( instanceId: string ): string {
	const gradientId = `${ instanceId }-miomesh`;
	return `
		<div class="mio-companion__device">
			<svg class="mio-companion__shell-art" viewBox="0 0 72 100" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
				<path class="mio-companion__loop-shadow" d="M31 0H41V1H44V3H46V8H44V10H41V11H31V10H28V8H26V3H28V1H31Z" />
				<path class="mio-companion__loop-face" d="M32 1H40V2H43V4H44V7H42V9H30V8H28V4H30V2H32Z" />
				<path class="mio-companion__loop-hole" d="M33 3H39V4H41V7H39V8H33V7H31V4H33Z" />
				<path class="mio-companion__shell-shadow" d="M29 8H43V9H49V11H54V14H59V18H63V23H66V29H69V36H71V58H70V67H68V75H65V82H61V88H56V93H50V96H44V98H40V100H32V99H27V97H22V94H17V90H13V85H9V79H6V72H4V64H2V56H1V37H2V30H4V24H7V19H11V15H16V12H22V10H29Z" />
				<path class="mio-companion__shell-face" d="M29 10H43V11H49V13H54V16H58V20H61V25H64V31H67V38H69V57H68V66H66V74H63V80H59V86H54V90H48V93H42V95H39V97H33V96H28V94H23V91H18V87H14V82H10V76H8V70H6V62H4V55H3V38H4V31H6V25H9V20H13V16H18V13H23V11H29Z" />
				<path class="mio-companion__shell-highlight" d="M29 11H23V13H18V16H14V20H10V25H8V31H6V38H5V55H6V62H8V69H10V75H12V70H10V62H8V54H7V39H8V32H10V26H13V21H17V17H22V14H29Z" />
				<path class="mio-companion__shell-shade" d="M64 31H67V38H69V57H68V66H66V74H63V80H59V86H54V90H48V93H42V95H38V92H47V89H53V85H58V79H61V73H63V65H65Z" />
			</svg>
			<h2 class="mio-companion__title"></h2>
			<div class="mio-companion__screen" role="group">
				<button class="mio-companion__mio" type="button" data-action="boop">
					<svg viewBox="0 0 48 48" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
						<defs>
							<linearGradient id="${ gradientId }" x1="8" y1="7" x2="41" y2="40" gradientUnits="userSpaceOnUse">
								<stop offset="0" stop-color="#f252fc" />
								<stop offset=".32" stop-color="#f252fc" />
								<stop offset=".32" stop-color="#cf61f7" />
								<stop offset=".58" stop-color="#cf61f7" />
								<stop offset=".58" stop-color="#9d76ff" />
								<stop offset=".78" stop-color="#9d76ff" />
								<stop offset=".78" stop-color="#554cff" />
								<stop offset="1" stop-color="#554cff" />
							</linearGradient>
						</defs>
						<path class="mio-companion__ring" fill="url(#${ gradientId })" d="M18 4H29V5H34V7H38V9H41V13H43V18H44V29H43V34H41V38H38V41H33V43H29V42H26V40H23V42H19V43H14V42H11V40H8V37H6V33H5V18H6V14H8V10H11V7H15V5H18Z" />
						<path class="mio-companion__interior" d="M19 8H29V9H33V11H36V13H38V16H40V20H41V29H40V33H38V36H35V38H31V39H28V37H25V35H22V37H19V39H15V38H12V36H10V33H9V29H8V20H9V16H11V13H14V10H19Z" />
					<g class="mio-companion__eyes">
							<path d="M17 17H20V18H21V26H20V27H17V26H16V18H17Z" />
							<path d="M29 17H32V18H33V26H32V27H29V26H28V18H29Z" />
					</g>
					</svg>
				</button>
				<p class="mio-companion__status" role="status" aria-live="polite" aria-atomic="true"></p>
			</div>
			<div class="mio-companion__actions" role="group">
				<button class="mio-companion__control" type="button" data-action="starlight"><span class="mio-companion__control-cap" aria-hidden="true"><svg viewBox="0 0 12 12" shape-rendering="crispEdges"><path d="M5 0H7V4H12V7H7V12H5V7H0V4H5Z" /></svg></span><span class="mio-companion__control-label"></span></button>
				<button class="mio-companion__control" type="button" data-action="quiet"><span class="mio-companion__control-cap" aria-hidden="true"><svg viewBox="0 0 12 12" shape-rendering="crispEdges"><path d="M0 3H3V2H6V3H9V2H12V5H9V6H6V5H3V6H0ZM0 8H3V7H6V8H9V7H12V10H9V11H6V10H3V11H0Z" /></svg></span><span class="mio-companion__control-label"></span></button>
				<button class="mio-companion__control" type="button" data-action="explore"><span class="mio-companion__control-cap" aria-hidden="true"><svg viewBox="0 0 12 12" shape-rendering="crispEdges"><path d="M5 1H12V8H9V6H7V8H5V10H3V12H0V9H2V7H4V5H6V4H5Z" /></svg></span><span class="mio-companion__control-label"></span></button>
			</div>
			<p class="mio-companion__note"></p>
		</div>
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
