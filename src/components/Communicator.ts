import { ConditionVariable, HashMap, Pair } from "tstl";

import { Driver } from "../typings/Driver";
import { serializeError } from "../utils/internal/serializeError";
import { Invoke } from "./Invoke";

/**
 * The basic communicator.
 *
 * The `Communicator` is an abstract class taking full charge of network communication.
 * Protocolized communicators like {@link WebSocketConnector} are realized by extending this
 * `Communicator` class.
 *
 * You want to make your own communicator using special protocol, extends this `Communicator`
 * class. After the extending, implement your special communicator by overriding those methods.
 *
 *   - {@link inspectReady}
 *   - {@link replyData}
 *   - {@link sendData}
 *
 * @template Provider Type of features provided for remote system.
 * @template Remote Type of features supported by remote system, used for {@link getDriver} function.
 * @author Jeongho Nam - https://github.com/samchon
 */
export abstract class Communicator<
  Provider extends object | null | undefined,
  Remote extends object | null,
> {
  /**
   * @hidden
   */
  private static SEQUENCE: number = 0;

  /**
   * @hidden
   */
  protected provider_: Provider;

  /**
   * @hidden
   */
  private driver_: Driver<object, true | false>;

  /**
   * @hidden
   */
  private promises_: HashMap<number, Pair<FunctionLike, FunctionLike>>;

  /**
   * @hidden
   */
  private join_cv_: ConditionVariable;

  /* ----------------------------------------------------------------
    CONSTRUCTORS
  ---------------------------------------------------------------- */
  /**
   * Initializer Constructor.
   *
   * @param provider An object providing features for remote system.
   */
  protected constructor(provider: Provider) {
    // PROVIDER & DRIVER
    this.provider_ = provider;
    this.driver_ = new Proxy<object>(new Driver(), {
      get: ({}, name: string) => {
        if (name === "then") return null;
        else return this._Proxy_func(name);
      },
    }) as any;

    // OTHER MEMBERS
    this.promises_ = new HashMap();
    this.join_cv_ = new ConditionVariable();
  }

  /**
   * Destroy the communicator.
   *
   * A destroy function must be called when the network communication has been closed.
   * It would destroy all function calls in the remote system (by `Driver<Controller>`),
   * which are not returned yet.
   *
   * The *error* instance would be thrown to those function calls. If the disconnection is
   * abnormal, then write the detailed reason why into the *error* instance.
   *
   * @param error An error instance to be thrown to the unreturned functions.
   */
  protected async destructor(error?: Error): Promise<void> {
    // REJECT UNRETURNED FUNCTIONS
    const rejectError: Error = error
      ? error
      : new Error("Connection has been closed.");

    for (const entry of this.promises_) {
      const reject: FunctionLike = entry.second.second;
      reject(rejectError);
    }

    // CLEAR PROMISES
    this.promises_.clear();

    // RESOLVE JOINERS
    await this.join_cv_.notify_all();
  }

  /**
   * A predicator inspects whether the *network communication* is on ready.
   *
   * @param method The method name for tracing.
   */
  protected abstract inspectReady(method: string): Error | null;

  /**
   * @hidden
   */
  private _Proxy_func(name: string): FunctionLike {
    const func = (...params: any[]) => this._Call_function(name, ...params);

    return new Proxy(func, {
      get: ({}, newName: string) => {
        if (newName === "bind")
          return (thisArg: any, ...args: any[]) => func.bind(thisArg, ...args);
        else if (newName === "call")
          return (thisArg: any, ...args: any[]) => func.call(thisArg, ...args);
        else if (newName === "apply")
          return (thisArg: any, args: any[]) => func.apply(thisArg, args);

        return this._Proxy_func(`${name}.${newName}`);
      },
    });
  }

  /**
   * @hidden
   */
  private _Call_function(name: string, ...params: any[]): Promise<any> {
    return new Promise(async (resolve, reject) => {
      // READY TO SEND ?
      const error: Error | null = this.inspectReady(
        "Communicator._Call_fuction",
      );
      if (error) {
        reject(error);
        return;
      }

      // CONSTRUCT INVOKE MESSAGE
      const invoke: Invoke.IFunction = {
        uid: ++Communicator.SEQUENCE,
        listener: name,
        parameters: params.map((p) => ({
          type: typeof p,
          value: p,
        })),
      };

      // DO SEND WITH PROMISE
      this.promises_.emplace(invoke.uid, new Pair(resolve, reject));
      await this.sendData(invoke);
    });
  }

  /* ----------------------------------------------------------------
    ACCESSORS
  ---------------------------------------------------------------- */
  /**
   * Set `Provider`
   *
   * @param obj An object would be provided for remote system.
   */
  public setProvider(obj: Provider): void {
    this.provider_ = obj;
  }

  /**
   * Get current `Provider`.
   *
   * Get an object providing features (functions & objects) for remote system. The remote
   * system would call the features (`Provider`) by using its `Driver<Controller>`.
   *
   * @return Current `Provider` object
   */
  public getProvider(): Provider {
    return this.provider_;
  }

  /**
   * Get Driver for RFC (Remote Function Call).
   *
   * The `Controller` is an interface who defines provided functions from the remote
   * system. The `Driver` is an object who makes to call remote functions, defined in
   * the `Controller` and provided by `Provider` in the remote system, possible.
   *
   * In other words, calling a functions in the `Driver<Controller>`, it means to call
   * a matched function in the remote system's `Provider` object.
   *
   *   - `Controller`: Definition only
   *   - `Driver`: Remote Function Call
   *
   * @template Controller An interface for provided features (functions & objects) from the remote system (`Provider`).
   * @template UseParametric Whether to convert type of function parameters to be compatible with their primitive.
   * @return A Driver for the RFC.
   */
  public getDriver<
    Controller extends NonNullable<Remote> = NonNullable<Remote>,
    UseParametric extends boolean = false,
  >(): Driver<Controller, UseParametric> {
    return this.driver_ as Driver<Controller, UseParametric>;
  }

  /**
   * Join connection.
   *
   * Wait until the connection to be closed.
   */
  public join(): Promise<void>;

  /**
   * Join connection or timeout.
   *
   * Wait until the connection to be closed until timeout.
   *
   * @param ms The maximum milliseconds for joining.
   * @return Whether awaken by disconnection or timeout.
   */
  public join(ms: number): Promise<boolean>;

  /**
   * Join connection or time expiration.
   *
   * Wait until the connection to be closed until time expiration.
   *
   * @param at The maximum time point to join.
   * @return Whether awaken by disconnection or time expiration.
   */
  public join(at: Date): Promise<boolean>;

  public async join(param?: number | Date): Promise<void | boolean> {
    // IS JOINABLE ?
    const error: Error | null = this.inspectReady(
      `${this.constructor.name}.join`,
    );
    if (error) throw error;

    // FUNCTION OVERLOADINGS
    if (param === undefined) await this.join_cv_.wait();
    else if (param instanceof Date)
      return await this.join_cv_.wait_until(param);
    else return await this.join_cv_.wait_for(param);
  }

  /* ================================================================
        COMMUNICATORS
            - REPLIER
            - SENDER
    ===================================================================
        REPLIER
    ---------------------------------------------------------------- */
  /**
   * Data Reply Function.
   *
   * A function should be called when data has come from the remote system.
   *
   * When you receive a message from the remote system, then parse the message with your
   * special protocol and covert it to be an *Invoke* object. After the conversion, call
   * this method.
   *
   * @param invoke Structured data converted by your special protocol.
   */
  protected replyData(invoke: Invoke): void {
    if ((invoke as Invoke.IFunction).listener)
      this._Handle_function(invoke as Invoke.IFunction).catch(() => {});
    else this._Handle_return(invoke as Invoke.IReturn);
  }

  /**
   * @hidden
   */
  private async _Handle_function(invoke: Invoke.IFunction): Promise<void> {
    const uid: number = invoke.uid;

    try {
      //----
      // FIND FUNCTION
      //----
      if (this.provider_ === undefined)
        // PROVIDER MUST BE
        throw new Error(
          `Error on Communicator._Handle_function(): the provider is not specified yet.`,
        );
      else if (this.provider_ === null)
        throw new Error(
          "Error on Communicator._Handle_function(): the provider would not be.",
        );

      // FIND FUNCTION (WITH THIS-ARG)
      let func: FunctionLike = this.provider_ as any;
      let thisArg: any = undefined;

      const routes: string[] = invoke.listener.split(".");
      for (const name of routes) {
        thisArg = func;
        func = thisArg[name];

        // SECURITY-ERRORS
        if (name[0] === "_")
          throw new Error(
            `Error on Communicator._Handle_function(): RFC does not allow access to a member starting with the underscore: Provider.${invoke.listener}()`,
          );
        else if (name[name.length - 1] === "_")
          throw new Error(
            `Error on Communicator._Handle_function(): RFC does not allow access to a member ending with the underscore: Provider.${invoke.listener}().`,
          );
        else if (name === "toString" && func === Function.toString)
          throw new Error(
            `Error on Communicator._Handle_function(): RFC on Function.toString() is not allowed: Provider.${invoke.listener}().`,
          );
        else if (name === "constructor" || name === "prototype")
          throw new Error(
            `Error on Communicator._Handle_function(): RFC does not allow access to ${name}: Provider.${invoke.listener}().`,
          );
      }
      func = func.bind(thisArg);

      //----
      // RETURN VALUE
      //----
      // CALL FUNCTION
      const parameters: any[] = invoke.parameters.map((p) => p.value);
      const ret: any = await func(...parameters);

      await this._Send_return(uid, true, ret);
    } catch (exp) {
      await this._Send_return(uid, false, exp);
    }
  }

  /**
   * @hidden
   */
  private _Handle_return(invoke: Invoke.IReturn): void {
    // GET THE PROMISE OBJECT
    const it = this.promises_.find(invoke.uid);
    if (it.equals(this.promises_.end())) return;

    // RETURNS
    const func: FunctionLike = invoke.success
      ? it.second.first
      : it.second.second;
    this.promises_.erase(it);

    func(invoke.value);
  }

  /* ----------------------------------------------------------------
    SENDER
  ---------------------------------------------------------------- */
  /**
   * A function sending data to the remote system.
   *
   * @param invoke Structured data to send.
   */
  protected abstract sendData(invoke: Invoke): Promise<void>;

  /**
   * @hidden
   */
  private async _Send_return(
    uid: number,
    success: boolean,
    value: any,
  ): Promise<void> {
    // SPECIAL LOGIC FOR ERROR -> FOR CLEAR JSON ENCODING
    if (success === false && value instanceof Error)
      value = serializeError(value);

    // RETURNS
    const ret: Invoke.IReturn = {
      uid,
      success,
      value,
    };
    await this.sendData(ret);
  }
}

type FunctionLike = (...args: any[]) => any;
