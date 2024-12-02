/**
 * Message structure for RPC (Remote Procedure Call).
 *
 * @author Jeongho Nam - https://github.com/samchon
 */
export type Invoke = Invoke.IFunction | Invoke.IReturn;

export namespace Invoke {
  /**
   * Message for Requesting RPC.
   */
  export interface IFunction {
    /**
     * Unique identifier.
     */
    uid: number;

    /**
     * Target function (sometimes capsuled in objects) to call.
     */
    listener: string;

    /**
     * Parameters for the function call.
     */
    parameters: IParameter[];
  }
  /**
   * Parameter for the function call.
   */
  export interface IParameter {
    /**
     * Type of the {@link value}.
     *
     * Actually, it stores result of the `typeof` statement.
     */
    type: string;

    /**
     * Value of the parameter.
     */
    value: any;
  }

  /**
   * Message for Returning RPC.
   */
  export interface IReturn {
    /**
     * Unique identifier.
     */
    uid: number;

    /**
     * `true` -> return, `false` -> exception.
     */
    success: boolean;

    /**
     * Returned value or thrown exception.
     */
    value: any;
  }
}
