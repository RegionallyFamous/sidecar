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
const MESSAGE_VISIBLE_MS = 2600;
let instanceCounter = 0;

export function mountMioWidget(
	container: HTMLElement,
	ctx: WidgetContext,
	copy: MioCopy = createMioCopy(),
): WidgetTeardown {
	let destroyed = false;
	let refreshId: ReturnType< typeof setInterval > | null = null;
	let reactionId: ReturnType< typeof setTimeout > | null = null;
	let messageId: ReturnType< typeof setTimeout > | null = null;
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
	const showMessage = ( message: string ): void => {
		setStatus( message );
		root.dataset.messageVisible = 'true';
		if ( messageId !== null ) {
			clearTimeout( messageId );
		}
		messageId = setTimeout( () => {
			if ( destroyed ) {
				return;
			}
			delete root.dataset.messageVisible;
			setStatus( '' );
			messageId = null;
		}, MESSAGE_VISIBLE_MS );
	};

	const render = (): void => {
		const mood = getMood( state );
		root.dataset.mood = mood;
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
			showMessage( copy.greetReaction );
			return;
		}

		const action = button.dataset.action;
		if ( isCareAction( action ) ) {
			state = applyCareAction( state, action, Date.now() );
			persist();
			react( action );
			render();
			showMessage( copy.actions[ action ].reaction );
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
		if ( messageId !== null ) {
			clearTimeout( messageId );
			messageId = null;
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
			<svg class="mio-companion__shell-art" viewBox="0 0 108 150" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
				<path class="mio-companion__loop-shadow" d="M46 0H62V1H67V3H70V6H72V12H70V15H67V17H41V15H38V12H36V6H38V3H41V1H46Z" />
				<path class="mio-companion__loop-face" d="M47 2H61V3H65V5H68V7H69V11H67V13H41V11H39V7H41V4H47Z" />
				<path class="mio-companion__loop-hole" d="M48 5H60V6H64V8H66V11H64V12H44V11H42V8H44V6H48Z" />
				<path class="mio-companion__shell-shadow" d="M43 12H65V13H74V15H82V18H89V22H95V28H100V36H104V46H107V58H108V90H107V102H105V114H106V126H105V136H104V142H96V146H87V148H72V149H65V150H46V149H39V148H27V147H17V143H9V138H4V130H1V119H0V58H1V47H4V37H8V29H13V23H19V18H27V15H36V13H43Z" />
				<path class="mio-companion__shell-face" d="M45 17H63V18H73V20H81V23H88V27H94V33H98V40H101V50H104V61H106V90H105V101H103V114H104V126H103V140H94V144H85V146H72V147H65V148H45V147H38V146H29V145H19V141H8V136H5V128H4V117H2V59H3V49H6V40H10V33H15V27H21V23H29V20H37V18H45Z" />
				<path class="mio-companion__shell-midlight" d="M45 19H37V21H29V24H22V28H16V34H12V42H8V51H6V61H5V97H7V108H9V117H12V125H15V120H13V110H11V98H9V62H10V52H13V43H17V35H23V29H30V25H38V22H45Z" />
				<path class="mio-companion__shell-highlight" d="M44 20H38V22H30V25H24V29H18V35H14V42H11V51H9V62H8V82H10V62H11V52H14V43H18V36H24V30H31V26H39V23H44Z" />
				<path class="mio-companion__shell-midshade" d="M101 49H104V61H106V90H105V101H102V112H98V122H93V130H87V136H79V141H70V144H62V146H46V143H69V140H78V136H85V131H91V124H95V115H99V104H101Z" />
				<path class="mio-companion__shell-shade" d="M104 61H106V90H105V101H102V112H98V122H93V130H87V136H79V140H72V137H79V133H86V127H91V120H95V111H98V100H100V90H102V62Z" />
			</svg>
			<h2 class="mio-companion__title"></h2>
			<div class="mio-companion__screen" role="group">
				<button class="mio-companion__mio" type="button" data-action="boop">
					<svg viewBox="0 0 48 48" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
						<defs>
							<linearGradient id="${ gradientId }" x1="8" y1="7" x2="41" y2="40" gradientUnits="userSpaceOnUse">
								<stop offset="0" stop-color="#f252fc" />
								<stop offset=".14" stop-color="#f252fc" />
								<stop offset=".14" stop-color="#e05afb" />
								<stop offset=".28" stop-color="#e05afb" />
								<stop offset=".28" stop-color="#c363fb" />
								<stop offset=".42" stop-color="#c363fb" />
								<stop offset=".42" stop-color="#aa67ff" />
								<stop offset=".56" stop-color="#aa67ff" />
								<stop offset=".56" stop-color="#a580ff" />
								<stop offset=".7" stop-color="#a580ff" />
								<stop offset=".7" stop-color="#7c68ff" />
								<stop offset=".84" stop-color="#7c68ff" />
								<stop offset=".84" stop-color="#4b3eff" />
								<stop offset="1" stop-color="#4b3eff" />
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
