/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-2016 Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import 'babel-polyfill';
import ReactDOM from 'react-dom';
import FastClick from 'fastclick';
import UniversalRouter from 'universal-router';
import routes from './routes';
import history from './core/history';
import {addEventListener, removeEventListener, windowScrollY,} from './core/DOMUtils';

const context = {
    insertCss: (...styles) => {
        const removeCss = styles.map(style => style._insertCss()); // eslint-disable-line no-underscore-dangle, max-len
        return () => {
            removeCss.forEach(f => f());
        };
    },
    setTitle: value => (document.title = value),
    setMeta: (name, content) => {
        // Remove and create a new <meta /> tag in order to make it work
        // with bookmarks in Safari
        const elements = document.getElementsByTagName('meta');
        Array.from(elements).forEach((element) => {
            if (element.getAttribute('name') === name) {
                element.parentNode.removeChild(element);
            }
        });
        const meta = document.createElement('meta');
        meta.setAttribute('name', name);
        meta.setAttribute('content', content);
        document
            .getElementsByTagName('head')[0]
            .appendChild(meta);
    },
};

// Restore the scroll position if it was saved into the state
function restoreScrollPosition({state, hash}) {
    if (state && state.scrollY !== undefined) {
        window.scrollTo(state.scrollX, state.scrollY);
        return;
    }

    const targetHash = hash && hash.substr(1);
    if (targetHash) {
        const target = document.getElementById(targetHash);
        if (target) {
            window.scrollTo(0, windowScrollY() + target.getBoundingClientRect().top);
            return;
        }
    }

    window.scrollTo(0, 0);
}

let renderComplete = (location, callback) => {
    const elem = document.getElementById('css');
    if (elem) elem.parentNode.removeChild(elem);
    callback(true);
    renderComplete = (l) => {
        restoreScrollPosition(l);

        // Google Analytics tracking. Don't send 'pageview' event after
        // the initial rendering, as it was already sent
        if (window.ga) {
            window.ga('send', 'pageview');
        }

        callback(true);
    };
};

function render(container, location, component) {
    return new Promise((resolve, reject) => {
        try {
            ReactDOM.render(
                component,
                container,
                renderComplete.bind(undefined, location, resolve)
            );
        } catch (err) {
            reject(err);
        }
    });
}

function run() {
    const container = document.getElementById('app');
    let currentLocation = history.location;
    const router = new UniversalRouter(routes, {
        context: {
            render: (a) => a,
            context: context
        },
    });

    // Make taps on links and buttons work fast on mobiles
    FastClick.attach(document.body);

    // Re-render the app when window.location changes
    function onLocationChange(location) {
        currentLocation = location;

        router.resolve(
            location.pathname
        ).then((component) => {
            render(container, location, component);
        }).catch(err => console.error(err)); // eslint-disable-line no-console
    }

    // Add History API listener and trigger initial change
    const removeHistoryListener = history.listen(onLocationChange);
    history.push(currentLocation, {init: 'yes'});

    // https://developers.google.com/web/updates/2015/09/history-api-scroll-restoration
    let originalScrollRestoration;
    if (window.history && 'scrollRestoration' in window.history) {
        originalScrollRestoration = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
    }

    // Prevent listeners collisions during history navigation
    addEventListener(window, 'pagehide', function onPageHide() {
        removeEventListener(window, 'pagehide', onPageHide);
        removeHistoryListener();
        if (originalScrollRestoration) {
            window.history.scrollRestoration = originalScrollRestoration;
            originalScrollRestoration = undefined;
        }
    });
}

function init() {


// Run the application when both DOM is ready and page content is loaded
    if (['complete', 'loaded', 'interactive'].includes(document.readyState) && document.body) {
        run();
    } else {
        document.addEventListener('DOMContentLoaded', run, false);
    }
}

export {init};