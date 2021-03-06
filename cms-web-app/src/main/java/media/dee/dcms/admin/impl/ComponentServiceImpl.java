package media.dee.dcms.admin.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import media.dee.dcms.admin.internal.ComponentResourceServlet;
import media.dee.dcms.admin.internal.ShortCommandName;
import media.dee.dcms.admin.services.AdminWebsocketDispatcher;
import media.dee.dcms.admin.services.ComponentService;
import media.dee.dcms.core.components.AdminModule;
import media.dee.dcms.core.components.WebComponent;
import org.osgi.framework.Bundle;
import org.osgi.framework.FrameworkUtil;
import org.osgi.framework.ServiceReference;
import org.osgi.service.component.annotations.*;
import org.osgi.service.http.HttpService;
import org.osgi.service.http.NamespaceException;
import org.osgi.service.log.LogService;

import java.io.File;
import java.util.LinkedList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

@Component(immediate = true, scope = ServiceScope.SINGLETON)
@ShortCommandName("components/essential/bundles")
@SuppressWarnings("unused")
public class ComponentServiceImpl implements ComponentService, WebComponent.Command {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final AtomicReference<LogService> logRef = new AtomicReference<>();
    private final AtomicReference<AdminWebsocketDispatcher> communicationHandler = new AtomicReference<>();
    private final List<WebComponent> guiComponents = new LinkedList<>();
    private final List<HttpService> httpServiceList = new LinkedList<>();
    private final LinkedList<String> registeredServlets = new LinkedList<>();


    public static Bundle getComponentBundle(WebComponent webComponent){
        return FrameworkUtil.getBundle(webComponent.getClass());
    }

    public static AdminModule getAdminModule(WebComponent webComponent){
        AdminModule adminModule = webComponent.getClass().getAnnotation(AdminModule.class);
        if( adminModule == null )
            throw new RuntimeException(String.format("WebComponent [%s] in bundle [%s] doesn't have AdminModule annotation!",
                    webComponent.getClass(), getComponentBundle(webComponent).toString() ));
        return adminModule;
    }

    public static File getBundleWebAdminResrouceFile(WebComponent webComponent){
        AdminModule adminModule = webComponent.getClass().getAnnotation(AdminModule.class);
        Bundle bundle = getComponentBundle(webComponent);
        File root = new File("/cms/");
        return new File(
                new File(new File(root, bundle.getSymbolicName()), bundle.getVersion().toString()),
                adminModule.resource()
        );
    }

    private ObjectNode getBundleInfo(WebComponent webComponent){
        AdminModule adminModule = getAdminModule(webComponent);
        Bundle bundle = getComponentBundle(webComponent);
        File jsModule = new File( getBundleWebAdminResrouceFile(webComponent), String.format("%s.js", adminModule.value()) );
        return objectMapper.createObjectNode()
                .put("bundlePath",  jsModule.getPath() )
                .put("SymbolicName", bundle.getSymbolicName())
                .put("Version", bundle.getVersion().toString());
    }

    private JsonNode getCommand(WebComponent component, CommandType commandType) {
        AdminModule adminModule = component.getClass().getAnnotation(AdminModule.class);
        Bundle bundle = FrameworkUtil.getBundle(component.getClass());
        File jsModule = new File( getBundleWebAdminResrouceFile(component), adminModule.value() );

        ObjectNode cmd = objectMapper.createObjectNode()
                .put("action", commandType.toString().toLowerCase());
        cmd.set("bundle", getBundleInfo(component));
        return cmd;

    }

    private void ModuleResourcesAction(WebComponent webComponent, ComponentResourcesAction resourcesAction) {
        AdminModule adminModule = getAdminModule(webComponent);
        Bundle bundle = getComponentBundle(webComponent);

        //get http service from osgi registry
        Bundle myself = FrameworkUtil.getBundle(this.getClass());
        ServiceReference<HttpService> ref = myself.getBundleContext().getServiceReference(HttpService.class);
        HttpService bundleHttpService = myself.getBundleContext().getService(ref);

        try {
            String path = getBundleWebAdminResrouceFile(webComponent).getPath();
            synchronized (this.registeredServlets) {
                switch (resourcesAction){
                    case Register:
                        if( this.registeredServlets.contains(path))
                            return;
                        bundleHttpService.registerServlet(
                                getBundleWebAdminResrouceFile(webComponent).getPath(),
                                new ComponentResourceServlet(webComponent),
                                null,
                                null
                        );
                        this.registeredServlets.add(path);
                        break;
                    case UnRegister:
                        if( this.registeredServlets.contains(path)) {
                            bundleHttpService.unregister(getBundleWebAdminResrouceFile(webComponent).getPath());
                            this.registeredServlets.remove(path);
                            return;
                        }
                        break;
                }
                logRef.get().log(LogService.LOG_DEBUG,
                        String.format("[%s]Resource of GUIComponent: %s%n\tMapping: %s --> [%s:%s]%s%n",
                            resourcesAction, webComponent.getClass().getName(), path,
                            bundle.getSymbolicName(), bundle.getVersion(), adminModule.resource()));
            }
        } catch (Exception exception) {
            switch (resourcesAction){
                case Register:
                    logRef.get().log(LogService.LOG_ERROR, String.format("Error while registering httpService Resource of GUIComponent: %s", webComponent.getClass().getName()), exception);
                    break;
                case UnRegister:
                    logRef.get().log(LogService.LOG_ERROR, String.format("Error while un-registering httpService Resource of GUIComponent: %s", webComponent.getClass().getName()), exception);
                    break;
            }
        } finally {
            bundle.getBundleContext().ungetService(ref);
        }
    }

    @Activate
    public void activate() {
        LogService log = logRef.get();
        log.log(LogService.LOG_INFO, "CMS Component Service Activated");
    }

    @Reference
    public void setLogService(LogService log) {
        logRef.set(log);
    }


    @Override
    public void bindCommunicationHandler(AdminWebsocketDispatcher websocketDispatcher) {
        this.communicationHandler.set(websocketDispatcher);
    }

    @Override
    public void unbindCommunicationHandler(AdminWebsocketDispatcher websocketDispatcher) {
        this.communicationHandler.compareAndSet(websocketDispatcher, null);
    }


    @Reference(cardinality = ReferenceCardinality.AT_LEAST_ONE, unbind = "unbindHttpService", policy = ReferencePolicy.DYNAMIC)
    public void bindHttpService(HttpService httpService) {
        synchronized (httpServiceList) {
            httpServiceList.add(httpService);
        }

        try {
            httpService.registerResources("/cms/fe", "/webapp", null);
        } catch (NamespaceException e) {
            throw new RuntimeException(e);
        }

        guiComponents.parallelStream()
                .forEach(guiComponent -> ModuleResourcesAction(guiComponent, ComponentResourcesAction.Register));
    }

    public void unbindHttpService(HttpService httpService) {
        synchronized (httpServiceList) {
            httpServiceList.remove(httpService);
        }

        httpService.unregister("/cms/fe");

        guiComponents.parallelStream()
                .forEach(guiComponent -> ModuleResourcesAction(guiComponent, ComponentResourcesAction.UnRegister));

    }

    @Reference(cardinality = ReferenceCardinality.MULTIPLE, unbind = "unbindEssentialComponent", policy = ReferencePolicy.DYNAMIC)
    public void bindEssentialComponent(WebComponent component) {
        synchronized (guiComponents) {

            guiComponents.add(component);
            httpServiceList.parallelStream()
                    .forEach(httpService -> ModuleResourcesAction(component, ComponentResourcesAction.Register));

            AdminModule adminModule = getAdminModule(component);

            if (adminModule.autoInstall() && communicationHandler.get() !=null )

                communicationHandler.get().send(getCommand(component, CommandType.Install));

        }
    }

    public void unbindEssentialComponent(WebComponent component) {
        synchronized (guiComponents) {

            guiComponents.remove(component);

            httpServiceList.parallelStream()
                    .forEach(httpService -> ModuleResourcesAction(component, ComponentResourcesAction.UnRegister));

            if( communicationHandler.get() != null )
                communicationHandler.get().send(getCommand(component, CommandType.Uninstall));
        }
    }


    @Override
    public JsonNode execute(JsonNode... arguments) {
        final ArrayNode bundles = objectMapper.createArrayNode();

        guiComponents.stream()
                .filter(guiComponent ->
                        guiComponent.getClass().getAnnotation(AdminModule.class) != null &&
                                guiComponent.getClass().getAnnotation(AdminModule.class).autoInstall())
                .map(this::getBundleInfo)
                .forEach(bundles::add);
        return bundles;
    }
}
