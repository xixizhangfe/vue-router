import { warn } from '../util/warn'
import { extend } from '../util/misc'

export default {
  name: 'RouterView',
  functional: true,
  props: {
    name: {
      type: String,
      default: 'default'
    }
  },
  render (_, { props, children, parent, data }) {
    // used by devtools to display a router-view badge
    data.routerView = true

    // directly use parent context's createElement() function
    // so that components rendered by router-view can resolve named slots
    // 直接使用父上下文的createElement()函数, 这样，router-view呈现的组件就可以解析指定的插槽
    // 获取父上下文的h
    const h = parent.$createElement
    const name = props.name
    // 获取当前的路由对象
    const route = parent.$route
    const cache = parent._routerViewCache || (parent._routerViewCache = {})

    // determine current view depth, also check to see if the tree
    // has been toggled inactive but kept-alive.
    /*
      router-view 最主要的是  如何在嵌套路由和命名视图的时候 知道自己应该渲染哪一个视图？

      inactive 的作用？
      在一个组件中可以存在多个视图插槽，如果某一个视图插槽的 组件节点 使用了 v-if 且为false 但是设置 keep-alive。 那么这时候其子孙节点应该不加载，
      所以这时候就是保存了其祖先节点是否是激活的状态。如果有一个不是激活的状态那么他就不应该渲染
     */
    let depth = 0
    let inactive = false
    // parent._routerRoot表示的是根 Vue 实例
    // 那么这个循环就是从当前的 <router-view> 的父节点向上找，一直找到根 Vue 实例，在这个
    // 过程，如果碰到了父节点也是 <router-view> 的时候，说明 <router-view> 有嵌套的情况，depth++
    while (parent && parent._routerRoot !== parent) {
      const vnodeData = parent.$vnode && parent.$vnode.data
      if (vnodeData) {
        if (vnodeData.routerView) {
          depth++
        }
        // 组件节点存在不激活的状态  即 v-if='false'
        // 那么这时候 这个视图插槽也不应该渲染
        if (vnodeData.keepAlive && parent._inactive) {
          inactive = true
        }
      }
      parent = parent.$parent
    }
    data.routerViewDepth = depth

    // render previous view if the tree is inactive and kept-alive
    // 如果树为非活动的且kept-alive，则呈现前一个视图
    if (inactive) {
      return h(cache[name], data, children)
    }

    // route.matched 保存了当前路由匹配的路由对象，其顺序为 父在前子在后。  所以depth 其实就可以认为是 matched的下标
    // 遍历完成后，根据当前线路匹配的路径和 depth 找到对应的 RouteRecord，进而找到该渲染的组件。
    const matched = route.matched[depth]
    // render empty node if no matched route
    if (!matched) {
      cache[name] = null
      return h()
    }

    // 获取指定路由的 组件，并缓存到父组件的 parent._routerViewCache[name]
    const component = cache[name] = matched.components[name]

    // 下面就是 将当前 router-view 占位符节点 渲染成指定的 component 组件
    // attach instance registration hook
    // this will be called in the instance's injected lifecycle hooks
    // 给 vnode 的 data 定义了 registerRouteInstance 方法，在 src/install.js 中，我们会调用该方法去注册路由的实例
    data.registerRouteInstance = (vm, val) => {
      // val could be undefined for unregistration
      const current = matched.instances[name]
      if (
        (val && current !== vm) ||
        (!val && current === vm)
      ) {
        matched.instances[name] = val
      }
    }

    // also register instance in prepatch hook
    // in case the same component instance is reused across different routes
    // 还可以在prepatch hook中注册实例，以防相同的组件实例在不同的路由中被重用
    ;(data.hook || (data.hook = {})).prepatch = (_, vnode) => {
      matched.instances[name] = vnode.componentInstance
    }

    // register instance in init hook
    // in case kept-alive component be actived when routes changed
    data.hook.init = (vnode) => {
      if (vnode.data.keepAlive &&
        vnode.componentInstance &&
        vnode.componentInstance !== matched.instances[name]
      ) {
        matched.instances[name] = vnode.componentInstance
      }
    }

    // resolve props
    /*
      使用 props 将组件和路由解耦。
      我们获取 动态路由的参数是   this.$router.params.xxx;
      但是我们可以通过 props属性将其跟组件解耦，或变成组件的 props属性  props: ['xxx']
      如果设置成 true object function 那么这时候其将会作为 data.props
    */
    let propsToPass = data.props = resolveProps(route, matched.props && matched.props[name])
    if (propsToPass) {
      // clone to prevent mutation
      propsToPass = data.props = extend({}, propsToPass)
      // pass non-declared props as attrs
      const attrs = data.attrs = data.attrs || {}
      // 将matched.props 通过 attrs属性传递给子组件那样子组件就可以通过 props['id'...] 获取
      for (const key in propsToPass) {
        // 如果组件上props没有定义此属性，那么就不需要传递
        if (!component.props || !(key in component.props)) {
          // 存放在 data.attrs属性上，同时也可以覆盖 router-view id='xx'时定义的属性
          attrs[key] = propsToPass[key]
          delete propsToPass[key]
        }
      }
    }

    // render 函数的最后根据 component 渲染出对应的组件 vonde：
    return h(component, data, children)
  }
}

/**
 * 处理 view-router中 parmas 与组件进行解耦
 *
    {
        path: '/user/:id',
        components: { default: User, sidebar: Sidebar },
        props: { default: true, sidebar: false }
    }
    props : Object   那么  User组件中  { props : ['id'] },   Sidebar组件 ： { this.$route.params.id}
    props : function 那么
        props: { default: true, sidebar: (route) => {({ orderId : route.params.id })) } 那么 Sidebar组件 ：  { props : ['orderId'] }
    props : Boolean
        props: true ;   这时候不区分命名视图，当前路由所有的视图都使用 { props : ['id'] }
 */
function resolveProps (route, config) {
  switch (typeof config) {
    case 'undefined':
      return
    case 'object':
      return config
    case 'function':
      return config(route)
    case 'boolean':
      return config ? route.params : undefined
    default:
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false,
          `props in "${route.path}" is a ${typeof config}, ` +
          `expecting an object, function or boolean.`
        )
      }
  }
}
