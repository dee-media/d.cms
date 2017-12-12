import {isFunction} from "./utils";

class BundleContext{
    constructor(context, activators) {
        this.context = context;
        this.childContexts = {};
        this.serviceInstances = {};
        this.activiators = activators || [];

        //if main context then register bundle.install and bundle.uninstall listeners
        if( !context ){
            window.addEventListener('ws:bundle.install', (event)=>{
                let command = event.detail;
                let bundles = Array.isArray(command.bundle) ? command.bundle : [command.bundle];
                bundles.forEach( (bundle)=>{
                    bundleContext.installBundle( bundle, (bundleContext, exports)=>{
                        console.info(`Bundle: ${command.bundle} installed.`);
                    });
                });
            });
            window.addEventListener('ws:bundle.uninstall', (event)=>{
                let command = event.detail;
                console.info(`Uninstall Bundle ${command.bundle}`);
                bundleContext.removeBundle(command.bundle, ()=>{
                    console.info(`Bundle: ${command.bundle} Uninstalled.`);
                });
            });
        }
    }

    addServiceListener(event, listener){
        BundleContext.ServiceListeners[event] = BundleContext.ServiceListeners[event] || [];
        BundleContext.ServiceListeners[event].push(listener);
    }

    removeServiceListener(event, listener){
        BundleContext.ServiceListeners[event] = BundleContext.ServiceListeners[event] || [];
        let idx = BundleContext.ServiceListeners[event].indexOf(listener);
        if( idx >= 0 )
            BundleContext.ServiceListeners[event].splice(idx, 1);
    }

    triggerServiceEvent(event, serviceReference){
        BundleContext.ServiceListeners[event] = BundleContext.ServiceListeners[event] || [];
        BundleContext.ServiceListeners[event].forEach( listener => listener.call(listener, serviceReference));
    }

    activate(){
        this.activiators.forEach( activator => activator.start(this) );
    }

    deactivate(){
        this.activiators.forEach( activator => activator.stop(this) );
    }


    installBundle(bundlePath, callback){
        let me = this;
        if( BundleContext.Bundles[bundlePath] ){
            let bundle = BundleContext.Bundles[bundlePath];
            callback(bundle.bundleContext, bundle.exports);
            return;
        }

        requireModule([bundlePath], (module)=>{
            let bundleContext = new BundleContext(me, module.activator ? [module.activator] : [] );
            me.childContexts[bundlePath] = bundleContext;
            BundleContext.Bundles[bundlePath] = {
                bundleContext: bundleContext,
                exports: module.exports
            };

            bundleContext.activate();
            callback(bundleContext, module.exports);
        });
    }


    removeBundle(bundlePath, callback){
        let bundle = BundleContext.Bundles[bundlePath];
        if( bundle ) {
            bundle.bundleContext.deactivate();

            unDefineModule(bundlePath);
            delete this.childContexts[bundlePath];
            delete BundleContext.Bundles[bundlePath];
        }
        callback();
    }


    registerService(cls, instance, props){
        BundleContext.ServiceReferences[cls] = BundleContext.ServiceReferences[cls] || {
            lastIndex: 0
        };
        let serviceProps = Object.assign({cls: cls}, props);

        let serviceReference = {
            context: this,
            props: serviceProps,
            cls: cls,
            instance : instance,
            usage: 0,
            getService: (context, ...args)=> {
                context.serviceInstances[cls] = context.serviceInstances[cls] || {};

                let serviceInstance = context.serviceInstances[cls][serviceReference.serviceIndex];
                if( serviceInstance )
                    return serviceInstance;

                serviceReference.usage += 1;
                serviceInstance = isFunction(instance) ? instance(context || this, ...args) : instance;

                context.serviceInstances[cls][serviceReference.serviceIndex] = serviceInstance;

                return serviceInstance
            },
            applyFilter: (filter)=>{
                let props = serviceReference.props;
                let match = true;
                for( let filterKey in filter )
                    match = props.hasOwnProperty(filterKey) && props[filterKey] === filter[filterKey] ;
                return match;
            }
        };

        /**
         * BundleContext.ServiceReferences[dc.menuItem] is dict
         * lastIndex?
         * 0 => ServiceReference
         * 1 => ServiceReference
         */

        let serviceReferenceDict = BundleContext.ServiceReferences[cls];
        serviceReference.serviceIndex = ++serviceReferenceDict.lastIndex;
        serviceReferenceDict[serviceReference.serviceIndex] = serviceReference;
        this.triggerServiceEvent('osgi:service:registered', serviceReference);

        return Object.assign({
            unregister: ()=>{
                delete serviceReferenceDict[serviceReference.serviceIndex];
                this.triggerServiceEvent('osgi:service:unregistered', serviceReference);
            }
        }, serviceReference);
    }

    ungetService(serviceReference){
        let cls = serviceReference.cls;
        let serviceIndex = serviceReference.serviceIndex;
        this.serviceInstances[cls] = this.serviceInstances[cls] || {};

        let serviceInstance = this.serviceInstances[cls][serviceIndex];
        if( serviceInstance ) {
            delete this.serviceInstances[cls][serviceIndex];
            serviceReference.usage -= 1;
        }
    }

    getServiceReferences(cls, filter){
        let serviceReferenceDict = BundleContext.ServiceReferences[cls] || {};
        return Object.keys(serviceReferenceDict)
            .filter( key => key !== 'lastIndex' )
            .map( key =>  serviceReferenceDict[key] )
            .filter( serviceReference => serviceReference.applyFilter(filter) );
    }
}

BundleContext.Bundles = {};
BundleContext.ServiceReferences = {};
BundleContext.ServiceListeners = {};

window.BundleContext = BundleContext;
export {BundleContext};